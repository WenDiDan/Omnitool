const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

// 获取用户历史保留天数（动态计算）
// 普通用户：返回管理员设置的 historyRetentionDays（默认3）
// VIP 用户：返回 VIP剩余天数 + historyRetentionDays（默认3），最少3天
// 管理员：返回 historyRetentionDays（默认36500）
async function getRetentionDays(openid, usersCollection) {
  try {
    const { data } = await usersCollection.where({ openid }).get()
    if (data.length === 0) return 3
    const user = data[0]
    const baseDays = user.historyRetentionDays || 3

    const role = user.role || 'user'
    if (role === 'admin') {
      return user.historyRetentionDays || 365
    }
    if (role === 'vip') {
      // 计算 VIP 剩余天数
      const vipExpiresAt = user.vipExpiresAt
      if (!vipExpiresAt) return baseDays // 无 VIP 过期时间，按普通用户算
      const expireDate = new Date(vipExpiresAt)
      const now = new Date()
      if (expireDate <= now) return baseDays // VIP 已过期，按普通用户算
      const remainDays = Math.ceil((expireDate - now) / (24 * 60 * 60 * 1000))
      // VIP 用户保留天数 = VIP 剩余时间（不低于基础天数）
      return Math.max(baseDays, remainDays)
    }
    // 普通用户：管理员可自定义保留天数（默认3天）
    return baseDays
  } catch (e) {
    return 3
  }
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { action } = event

  if (!OPENID) {
    return { success: false, error: '未获取到用户身份' }
  }

  const usersCollection = db.collection('users')
  const recycleBinCollection = db.collection('scan_recycle_bin')

  switch (action) {
    case 'setRetention':
      return await setRetention(OPENID, event.targetOpenid, event.days, usersCollection)
    case 'getRetention':
      return await getRetention(OPENID, event.targetOpenid, usersCollection)
    case 'recycle':
      return await recycleRecords(OPENID, event.records, recycleBinCollection)
    case 'getRecycled':
      return await getRecycled(OPENID, recycleBinCollection, usersCollection, event.debugDays)
    case 'restoreRecycled':
      return await restoreRecycled(OPENID, event.code, recycleBinCollection)
    case 'deleteRecycled':
      return await deleteRecycled(OPENID, event.code, recycleBinCollection)
    case 'restoreAllRecycled':
      return await restoreAllRecycled(OPENID, recycleBinCollection)
    case 'clearRecycled':
      return await clearRecycled(OPENID, recycleBinCollection)
    case 'insertTestData':
      return await insertTestData(OPENID, recycleBinCollection)
    default:
      return { success: false, error: '未知操作' }
  }
}

// 管理员设置用户历史保留天数
async function setRetention(callerOpenid, targetOpenid, days, usersCollection) {
  if (!targetOpenid || !days || days < 1 || days > 36500) {
    return { success: false, error: '参数无效（天数范围 1-36500）' }
  }

  // 验证调用者是否是管理员
  const { data: callerData } = await usersCollection.where({ openid: callerOpenid }).get()
  if (!callerData.length || callerData[0].role !== 'admin') {
    return { success: false, error: '权限不足，仅管理员可操作' }
  }

  // 更新目标用户（管理员可为任意角色设置保留天数）
  await usersCollection.where({ openid: targetOpenid }).update({
    data: { historyRetentionDays: days }
  })

  return { success: true, message: `已将用户保留天数设为 ${days} 天` }
}

// 获取用户历史保留天数
async function getRetention(callerOpenid, targetOpenid, usersCollection) {
  const effectiveOpenid = targetOpenid || callerOpenid

  // 如果查他人，需要管理员权限
  if (targetOpenid && targetOpenid !== callerOpenid) {
    const { data: callerData } = await usersCollection.where({ openid: callerOpenid }).get()
    if (!callerData.length || callerData[0].role !== 'admin') {
      return { success: false, error: '权限不足' }
    }
  }

  const days = await getRetentionDays(effectiveOpenid, usersCollection)
  return { success: true, days }
}

// 生成用于字符串比较的本地时间格式（yyyy-MM-dd HH:mm:ss）
// 同一格式下，字典序 = 时间顺序，可作为 db.command.lt 的安全参数
function formatLocalTime(dateOrTs) {
  const d = dateOrTs instanceof Date ? dateOrTs : new Date(dateOrTs)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const s = String(d.getSeconds()).padStart(2, '0')
  return `${y}-${m}-${day} ${h}:${mi}:${s}`
}

// ==================== 回收站相关 ====================

// 将本地清空的记录存入云端回收站
async function recycleRecords(openid, records, recycleBinCollection) {
  if (!Array.isArray(records) || records.length === 0) {
    return { success: true, recycled: 0 }
  }
  try {
    const recycledAt = formatLocalTime(Date.now())
    const recycledAtTs = Date.now()

    // 获取回收站已有记录（按 code 去重合并），集合不存在则视为空
    let existing = []
    try {
      const res = await recycleBinCollection
        .where({ _openid: openid })
        .get()
      existing = res.data
    } catch (e) {
      if (e.errCode !== -502005) throw e
    }
    const existingMap = {}
    existing.forEach(r => { existingMap[r.code] = r })

    let recycled = 0
    for (const record of records) {
      const exist = existingMap[record.code]
      if (exist) {
        const newCount = (exist.count || 0) + (record.count || 1)
        const newTime = (record.time || '') > (exist.time || '') ? record.time : exist.time
        await recycleBinCollection.doc(exist._id).update({
          data: {
            count: newCount,
            time: newTime,
            type: record.type || exist.type,
            wxScanType: record.wxScanType || exist.wxScanType || '',
            recycledAt,
            recycledAtTs,
            updatedAt: db.serverDate()
          }
        })
      } else {
        await recycleBinCollection.add({
          data: {
            _openid: openid,
            code: record.code,
            type: record.type || '',
            time: record.time || '',
            count: record.count || 1,
            wxScanType: record.wxScanType || '',
            recycledAt,
            recycledAtTs,
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
          }
        })
      }
      recycled++
    }
    console.log(`[回收站] 用户 ${openid} 存入 ${recycled} 条记录`)
    return { success: true, recycled }
  } catch (err) {
    return { success: false, error: err.message || String(err) }
  }
}

// 获取回收站记录列表（同时清理超过保留天数的记录）
// debugDays: 调试用，传入数字直接覆盖保留天数，0 表示所有记录立即过期
async function getRecycled(openid, recycleBinCollection, usersCollection, debugDays) {
  try {
    const { data } = await recycleBinCollection
      .where({ _openid: openid })
      .orderBy('recycledAtTs', 'desc')
      .limit(500)
      .get()

    // 根据用户保留天数过滤过期记录（debugDays 用于调试，优先级高于数据库配置）
    const retentionDays = (debugDays !== undefined && debugDays !== null) ? Number(debugDays) : await getRetentionDays(openid, usersCollection)
    const cutoffTs = (retentionDays === 0) ? (Date.now() + 1000) : (Date.now() - retentionDays * 24 * 60 * 60 * 1000)

    const valid = []
    const expired = []
    for (const r of data) {
      if (r.recycledAtTs && r.recycledAtTs >= cutoffTs) {
        valid.push(r)
      } else {
        expired.push(r)
      }
    }

    // 异步清理过期记录
    let cleaned = 0
    for (const r of expired) {
      try { await recycleBinCollection.doc(r._id).remove(); cleaned++ } catch (e) {}
    }
    if (expired.length > 0) {
      console.log(`[回收站清理] 用户 ${openid} 清理了 ${expired.length} 条过期记录（保留 ${retentionDays} 天）`)
    }

    return { success: true, records: valid, retentionDays, expiredCleaned: cleaned }
  } catch (err) {
    if (err.errCode === -502005) {
      return { success: true, records: [] }
    }
    return { success: false, error: err.message || String(err) }
  }
}

// 从回收站恢复一条记录（仅删除回收站记录，前端自行写本地存储）
async function restoreRecycled(openid, code, recycleBinCollection) {
  if (!code) return { success: false, error: '缺少条码参数' }
  try {
    const { data } = await recycleBinCollection
      .where({ _openid: openid, code })
      .get()
    if (data.length === 0) return { success: false, error: '回收站中未找到该记录' }

    const record = data[0]
    await recycleBinCollection.doc(record._id).remove()
    return { success: true, message: '已恢复', record: { code: record.code, time: record.time, count: record.count, type: record.type, wxScanType: record.wxScanType || '' } }
  } catch (err) {
    return { success: false, error: err.message || String(err) }
  }
}

// 从回收站永久删除一条记录
async function deleteRecycled(openid, code, recycleBinCollection) {
  if (!code) return { success: false, error: '缺少条码参数' }
  try {
    const { data } = await recycleBinCollection
      .where({ _openid: openid, code })
      .get()
    if (data.length === 0) return { success: false, error: '未找到该记录' }

    await recycleBinCollection.doc(data[0]._id).remove()
    return { success: true, message: '已永久删除' }
  } catch (err) {
    return { success: false, error: err.message || String(err) }
  }
}

// 清空回收站
async function clearRecycled(openid, recycleBinCollection) {
  try {
    const { data } = await recycleBinCollection
      .where({ _openid: openid })
      .limit(500)
      .get()
    if (data.length === 0) return { success: true, deleted: 0 }

    let deleted = 0
    for (const r of data) {
      try {
        await recycleBinCollection.doc(r._id).remove()
        deleted++
      } catch (e) { console.error('[回收站清除] 删除失败', r._id, e) }
    }
    console.log(`[回收站] 用户 ${openid} 清空了 ${deleted} 条记录`)
    return { success: true, deleted }
  } catch (err) {
    return { success: false, error: err.message || String(err) }
  }
}

// ==================== 测试数据生成 ====================
// 生成测试用回收站数据：10条4天前 + 10条1天前（仅管理员可用）
async function insertTestData(openid, recycleBinCollection) {
  try {
    // 权限校验：仅管理员可生成测试数据
    const usersCollection = db.collection('users')
    const { data: callerData } = await usersCollection.where({ openid }).get()
    if (!callerData.length || callerData[0].role !== 'admin') {
      return { success: false, error: '权限不足，仅管理员可生成测试数据' }
    }
    const now = Date.now()
    const oneDayMs = 24 * 60 * 60 * 1000
    const types = ['QR', 'EAN', 'URL', 'WIFI', 'TEL']

    const insertList = []
    // 生成 10 条 4 天前的记录
    for (let i = 0; i < 10; i++) {
      const ts = now - 4 * oneDayMs - i * 60000 // 每条隔1分钟，避免时间完全相同
      insertList.push({
        _openid: openid,
        code: `TEST-4D-${String(i + 1).padStart(2, '0')}`,
        type: types[i % types.length],
        time: formatLocalTime(ts),
        count: 1,
        wxScanType: 'test',
        recycledAt: formatLocalTime(ts),
        recycledAtTs: ts,
        createdAt: new Date(ts),
        updatedAt: new Date(ts)
      })
    }
    // 生成 10 条 1 天前的记录
    for (let i = 0; i < 10; i++) {
      const ts = now - 1 * oneDayMs - i * 60000
      insertList.push({
        _openid: openid,
        code: `TEST-1D-${String(i + 1).padStart(2, '0')}`,
        type: types[(i + 2) % types.length],
        time: formatLocalTime(ts),
        count: 1,
        wxScanType: 'test',
        recycledAt: formatLocalTime(ts),
        recycledAtTs: ts,
        createdAt: new Date(ts),
        updatedAt: new Date(ts)
      })
    }

    // 逐条插入
    let inserted = 0
    for (const item of insertList) {
      try {
        await recycleBinCollection.add({ data: item })
        inserted++
      } catch (e) {
        console.error('[测试数据] 插入失败', item.code, e)
      }
    }

    console.log(`[测试数据] 用户 ${openid} 插入了 ${inserted}/20 条测试记录`)
    return { success: true, inserted, total: 20, message: `已生成 ${inserted} 条测试数据（10条4天前 + 10条1天前）` }
  } catch (err) {
    return { success: false, error: err.message || String(err) }
  }
}

// 全部恢复：从回收站删除所有记录并返回记录列表（前端自行写本地存储）
async function restoreAllRecycled(openid, recycleBinCollection) {
  try {
    const { data: records } = await recycleBinCollection
      .where({ _openid: openid })
      .limit(500)
      .get()
    if (records.length === 0) return { success: true, restored: 0, records: [] }

    const resultRecords = []
    for (const record of records) {
      try { await recycleBinCollection.doc(record._id).remove() } catch (e) {}
      resultRecords.push({ code: record.code, type: record.type, time: record.time, count: record.count, wxScanType: record.wxScanType })
    }
    console.log(`[回收站] 用户 ${openid} 全部恢复了 ${resultRecords.length} 条`)
    return { success: true, restored: resultRecords.length, records: resultRecords }
  } catch (err) {
    return { success: false, error: err.message || String(err) }
  }
}
