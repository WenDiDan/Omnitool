const cloud = require('wx-server-sdk')
const { bjTime } = require('./_shared/time')
const { calcRetentionDays } = require('./_shared/retention')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

// 辅助：获取用户创建时间（优先级：createdAt > _createTime > _id 中的时间戳）
function getCreateTime(doc) {
  if (doc.createdAt) return doc.createdAt
  if (doc._createTime) {
    try {
      const d = new Date(doc._createTime)
      if (!isNaN(d.getTime())) return d.toISOString()
    } catch (e) { /* 忽略 */ }
  }
  // 从 _id 提取时间戳（ObjectId 前 4 字节 = 创建时间）
  if (doc._id) {
    try {
      const oid = typeof doc._id === 'string' ? doc._id : String(doc._id)
      const ts = parseInt(oid.substring(0, 8), 16)
      const d = new Date(ts * 1000)
      if (!isNaN(d.getTime())) return d.toISOString()
    } catch (e) { /* 忽略 */ }
  }
  return ''
}

/**
 * 检查VIP是否过期，过期则自动降级为普通用户
 * @returns {object} { role, level, roleLabel, vipExpiresAt }  — 返回最新权限信息
 */
async function checkVipExpiry(user, usersCollection) {
  if (user.role !== 'vip') {
    return { role: user.role, level: ROLES[user.role]?.level ?? 1, roleLabel: ROLES[user.role]?.label || '普通用户', vipExpiresAt: user.vipExpiresAt || '' }
  }

  // 没有设置过期时间 → 永久VIP，不过期
  if (!user.vipExpiresAt) {
    return { role: 'vip', level: 2, roleLabel: 'VIP用户', vipExpiresAt: '' }
  }

  const now = new Date()
  const expiresAt = new Date(user.vipExpiresAt)

  // 未过期
  if (expiresAt > now) {
    return { role: 'vip', level: 2, roleLabel: 'VIP用户', vipExpiresAt: user.vipExpiresAt }
  }

  // 已过期 → 自动降级为普通用户
  console.log(`[VIP过期] 用户 ${user.openid} VIP已过期 (${user.vipExpiresAt})，降级为普通用户`)
  try {
    await usersCollection.where({ openid: user.openid }).update({
      data: { role: 'user', vipExpiresAt: '', historyRetentionDays: 3 }
    })
  } catch (e) {
    console.error('[VIP过期] 降级写入失败', e)
  }
  return { role: 'user', level: 1, roleLabel: '普通用户', vipExpiresAt: '' }
}

// 角色定义
const ROLES = {
  admin: { label: '管理员', level: 3 },
  vip: { label: 'VIP用户', level: 2 },
  user: { label: '普通用户', level: 1 },
  blocked: { label: '已封禁', level: 0 }
}

// 检查用户是否被封禁
async function isBlocked(openid, usersCollection) {
  try {
    const { data } = await usersCollection.where({ openid }).get()
    if (data.length === 0) return false
    return data[0].role === 'blocked'
  } catch (e) {
    return false
  }
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { action } = event

  // 安全检查：小程序调用时必有 OPENID
  if (!OPENID) {
    return { success: false, error: '未获取到用户身份，请确保在小程序中调用' }
  }

  const usersCollection = db.collection('users')

  // 封禁用户检查：只有getInfo允许被封禁用户访问
  if (action !== 'getInfo' && action !== 'checkPermission') {
    const blocked = await isBlocked(OPENID, usersCollection)
    if (blocked) {
      return { success: false, error: '您的账号已被封禁，仅能登录' }
    }
  }

  switch (action) {
    case 'getInfo':
      return await getUserInfo(OPENID, usersCollection)
    case 'updateProfile':
      return await updateProfile(OPENID, event.nickName, event.avatarUrl, usersCollection)
    case 'setRole':
      return await setRole(OPENID, event.targetOpenid, event.role, event.vipExpiresAt, usersCollection)
    case 'deleteUser':
      return await deleteUser(OPENID, event.targetOpenid, usersCollection)
    case 'listUsers':
      return await listUsers(OPENID, event.page || 1, event.pageSize || 20, usersCollection, event.keyword, event.role)
    case 'checkPermission':
      return await checkPermission(OPENID, event.requiredLevel || 1, usersCollection)
    default:
      return { success: false, error: '未知操作' }
  }
}

// 缺失 createdAt 时，自动写入数据库（仅写入一次）
async function ensureCreatedAt(openid, doc, usersCollection) {
  if (doc.createdAt) return doc.createdAt
  const ts = getCreateTime(doc) || new Date().toISOString()
  try {
    await usersCollection.where({ openid }).update({ data: { createdAt: ts } })
  } catch (e) { /* 静默失败 */ }
  return ts
}

// 生成默认昵称（新用户 / 老用户昵称为空时兜底），如「用户4832」
function genNickname() {
  return '用户' + String(Math.floor(1000 + Math.random() * 9000))
}

// 获取当前用户信息，不存在则自动创建
async function getUserInfo(openid, usersCollection) {
  try {
    const { data } = await usersCollection.where({ openid }).get()
    if (data.length > 0) {
      const user = data.find(u => u.openid === openid) || data[0]
      const createdAt = await ensureCreatedAt(openid, user, usersCollection)

      // 检查VIP是否过期（过期会自动降级写库）
      const vipResult = await checkVipExpiry(user, usersCollection)

      // 老用户昵称为空时补一个自动昵称（只写一次，避免列表里全是「未设置」）
      let nickName = user.nickName || ''
      if (!nickName) {
        nickName = genNickname()
        try {
          await usersCollection.where({ openid }).update({ data: { nickName } })
        } catch (e) { /* 写库失败时本次展示仍使用生成值 */ }
      }

      // 计算有效保留天数（与 syncScanHistory 逻辑一致）
      let effectiveDays = user.historyRetentionDays || 3
      if (vipResult.role === 'vip' && vipResult.vipExpiresAt) {
        const expireDate = new Date(vipResult.vipExpiresAt)
        const now2 = new Date()
        if (expireDate > now2) {
          const remainDays = Math.ceil((expireDate - now2) / (24 * 60 * 60 * 1000))
          effectiveDays = Math.max(effectiveDays, remainDays)
        }
      } else if (vipResult.role === 'admin') {
        effectiveDays = user.historyRetentionDays || 36500
      }

      return {
        success: true,
        user: {
          openid,
          role: vipResult.role,
          roleLabel: vipResult.roleLabel,
          level: vipResult.level,
          nickName,
          avatarUrl: user.avatarUrl || '',
          avatarVersion: user.avatarVersion || 1,
          createdAt,
          isBlocked: vipResult.role === 'blocked',
          banReason: vipResult.role === 'blocked' ? (user.ban_reason || '') : '',
          bannedAt: vipResult.role === 'blocked' ? bjTime(user.bannedAt) : '',
          vipExpiresAt: vipResult.vipExpiresAt || '',
          historyRetentionDays: effectiveDays
        }
      }
    }

    return await createUser(openid, usersCollection)
  } catch (err) {
    // 集合可能不存在，尝试创建后重试
    if (err.errCode === -502005) {
      try { await db.createCollection('users') } catch (e) { /* 忽略 */ }
      return await createUser(openid, usersCollection)
    }
    return { success: false, error: err.message || String(err) }
  }
}

async function createUser(openid, usersCollection) {
  const now = new Date().toISOString()
  const nickName = genNickname()

  // 创建用户记录（自动生成默认昵称，可随时在个人中心修改）
  await usersCollection.add({
    data: { openid, role: 'user', nickName, avatarUrl: '', avatarVersion: 1, createdAt: now }
  })

  // 检查是否是第一个用户，自动设为管理员
  try {
    const countResult = await usersCollection.count()

    if (countResult.total <= 1) {
      await usersCollection.where({ openid }).update({ data: { role: 'admin' } })
      return {
        success: true,
        user: { openid, role: 'admin', roleLabel: '管理员', level: 3, nickName, avatarUrl: '', avatarVersion: 1, createdAt: now }
      }
    }
  } catch (e) {
    // count 查询失败时默认为普通用户
    console.error('统计用户数量失败', e)
  }

  return {
    success: true,
    user: { openid, role: 'user', roleLabel: '普通用户', level: 1, nickName, avatarUrl: '', avatarVersion: 1, createdAt: now }
  }
}

// 更新用户资料（昵称、头像）
async function updateProfile(openid, nickName, avatarUrl, usersCollection) {
  const data = {}
  if (nickName !== undefined) data.nickName = nickName
  if (avatarUrl !== undefined) {
    data.avatarUrl = avatarUrl
    // 如果更新了头像，递增版本号
    const { data: userData } = await usersCollection.where({ openid }).get()
    if (userData.length > 0) {
      const currentVersion = userData[0].avatarVersion || 1
      data.avatarVersion = currentVersion + 1
    }
  }
  if (Object.keys(data).length === 0) {
    return { success: false, error: '无更新内容' }
  }

  await usersCollection.where({ openid }).update({ data })
  return { success: true }
}

// 管理员设置用户角色
async function setRole(callerOpenid, targetOpenid, newRole, vipExpiresAt, usersCollection) {
  // 参数验证：targetOpenid 和 newRole 是必须的
  if (!targetOpenid || !newRole || !ROLES[newRole]) {
    return { success: false, error: '参数无效' }
  }

  // 验证调用者是否是管理员
  const { data: callerData } = await usersCollection.where({ openid: callerOpenid }).get()
  if (!callerData.length || callerData[0].role !== 'admin') {
    return { success: false, error: '权限不足，仅管理员可操作' }
  }

  // 获取目标用户当前信息
  const { data: targetData } = await usersCollection.where({ openid: targetOpenid }).get()
  if (!targetData.length) {
    return { success: false, error: '目标用户不存在' }
  }
  const targetUser = targetData[0]
  const currentRole = targetUser.role || 'user'

  // 防止把最后一个管理员降级（无论是谁操作的）
  if (newRole !== 'admin' && currentRole === 'admin') {
    const adminCount = (await usersCollection.where({ role: 'admin' }).count()).total
    if (adminCount <= 1) {
      return { success: false, error: '不能降级最后一个管理员' }
    }
  }

  // 构建更新数据
  const updateData = { role: newRole }

  // VIP 设置过期时间，同时将保留天数写入为VIP剩余天数（保持数据库与展示一致）
  if (newRole === 'vip' && vipExpiresAt) {
    updateData.vipExpiresAt = vipExpiresAt
    const expireDate = new Date(vipExpiresAt)
    const remainDays = Math.ceil((expireDate - new Date()) / (24 * 60 * 60 * 1000))
    updateData.historyRetentionDays = Math.max(3, remainDays)
  } else if (newRole === 'admin') {
    // 设为管理员：清除VIP信息，保留天数设为36500（永久）
    updateData.vipExpiresAt = ''
    updateData.historyRetentionDays = 36500
  } else if (newRole !== 'vip') {
    // 改为普通用户：清除过期时间并恢复默认保留天数
    updateData.vipExpiresAt = ''
    if (currentRole === 'vip' || currentRole === 'admin') {
      updateData.historyRetentionDays = 3
    }
  }

  // 执行角色更新
  await usersCollection.where({ openid: targetOpenid }).update({ data: updateData })

  const msg = newRole === 'vip' && vipExpiresAt
    ? `已将用户角色设为${ROLES[newRole].label}（有效期至 ${vipExpiresAt.substring(0, 10)}）`
    : `已将用户角色设为${ROLES[newRole].label}`

  return { success: true, message: msg }
}

// 管理员删除用户
async function deleteUser(callerOpenid, targetOpenid, usersCollection) {
  // 参数验证
  if (!targetOpenid) {
    return { success: false, error: '参数无效' }
  }

  // 验证调用者是否是管理员
  const { data: callerData } = await usersCollection.where({ openid: callerOpenid }).get()
  if (!callerData.length || callerData[0].role !== 'admin') {
    return { success: false, error: '权限不足，仅管理员可删除用户' }
  }

  // 不能删除自己
  if (callerOpenid === targetOpenid) {
    return { success: false, error: '不能删除自己' }
  }

  // 获取目标用户信息
  const { data: targetData } = await usersCollection.where({ openid: targetOpenid }).get()
  if (!targetData.length) {
    return { success: false, error: '目标用户不存在' }
  }

  // 如果要删除的是管理员，检查是否是最后一个管理员
  if (targetData[0].role === 'admin') {
    const adminCount = (await usersCollection.where({ role: 'admin' }).count()).total
    if (adminCount <= 1) {
      return { success: false, error: '不能删除最后一个管理员' }
    }
  }

  // 执行删除
  await usersCollection.where({ openid: targetOpenid }).remove()

  return { success: true, message: '用户已删除' }
}

// 管理员列出所有用户（分页 + 关键词检索，保留天数随列表返回）
async function listUsers(callerOpenid, page, pageSize, usersCollection, keyword, role) {
  // 验证管理员权限
  const { data: callerData } = await usersCollection.where({ openid: callerOpenid }).get()
  if (!callerData.length || callerData[0].role !== 'admin') {
    return { success: false, error: '权限不足，仅管理员可查看' }
  }

  // 分页参数兜底：page ≥ 1，pageSize 限制在 10-100，避免一次拉取过多
  const pageNum = Math.max(1, Number(page) || 1)
  const sizeNum = Math.min(100, Math.max(10, Number(pageSize) || 50))
  const skip = (pageNum - 1) * sizeNum

  // 角色筛选（统计卡点击，可选）+ 关键词：昵称 / openid 模糊匹配（正则转义并限制长度）
  const VALID_ROLES = ['admin', 'vip', 'user', 'blocked']
  const roleFilter = VALID_ROLES.includes(role) ? role : ''
  const kw = String(keyword || '').trim().slice(0, 50)
  const conditions = []
  if (roleFilter) conditions.push({ role: roleFilter })
  if (kw) {
    const safe = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    conditions.push(_.or([
      { nickName: db.RegExp({ regexp: safe, options: 'i' }) },
      { openid: db.RegExp({ regexp: safe, options: 'i' }) }
    ]))
  }
  let query = usersCollection
  if (conditions.length === 1) {
    query = usersCollection.where(conditions[0])
  } else if (conditions.length === 2) {
    query = usersCollection.where(_.and(conditions))
  }

  // 并行执行查询和统计（角色统计为全量口径，与关键词过滤无关）
  const [usersResult, countResult, adminCount, vipCount, userCount, blockedCount] = await Promise.all([
    query.skip(skip).limit(sizeNum).get(),
    query.count(),
    usersCollection.where({ role: 'admin' }).count(),
    usersCollection.where({ role: 'vip' }).count(),
    usersCollection.where({ role: 'user' }).count(),
    usersCollection.where({ role: 'blocked' }).count()
  ])

  // 收集需要转换的云存储头像
  const cloudAvatars = []
  usersResult.data.forEach(u => {
    if (u.avatarUrl && u.avatarUrl.startsWith('cloud://')) {
      cloudAvatars.push({ openid: u.openid, fileID: u.avatarUrl })
    }
  })

  // 批量获取云存储临时URL
  let cloudUrls = {}
  if (cloudAvatars.length > 0) {
    try {
      const fileList = cloudAvatars.map(item => ({ fileID: item.fileID, maxAge: 0 }))
      const urlRes = await cloud.getTempFileURL({ fileList })
      if (urlRes.fileList) {
        urlRes.fileList.forEach(f => {
          if (f.status === 0 && f.tempFileURL) {
            cloudUrls[f.fileID] = f.tempFileURL
          }
        })
      }
    } catch (e) {
      console.error('获取头像URL失败', e)
    }
  }

  // 处理头像URL
  const processAvatarUrl = (url) => {
    if (!url) return ''
    // cloud:// 转临时URL
    if (url.startsWith('cloud://') && cloudUrls[url]) {
      return cloudUrls[url]
    }
    // http 转 https
    if (url.startsWith('http://thirdwx.qlogo.cn') || url.startsWith('http://wx.qlogo.cn')) {
      return url.replace('http://', 'https://')
    }
    return url
  }

  // 后台修复缺失的 createdAt（不阻塞响应）
  usersResult.data
    .filter(u => !u.createdAt)
    .forEach(u => ensureCreatedAt(u.openid, u, usersCollection))

  // 批量检查 VIP 过期：并行执行，避免逐个等待；完成后按同一筛选条件重读
  const vipUsers = usersResult.data.filter(u => u.role === 'vip' && u.vipExpiresAt)
  if (vipUsers.length > 0) {
    await Promise.all(vipUsers.map(vip => checkVipExpiry(vip, usersCollection)))
    const refreshed = await query.skip(skip).limit(sizeNum).get()
    usersResult.data = refreshed.data
  }

  // 管理员浏览到的空昵称用户就地补齐（与 getUserInfo 同一口径，仅首次写库）
  const emptyNickUsers = usersResult.data.filter(u => !u.nickName)
  if (emptyNickUsers.length > 0) {
    await Promise.all(emptyNickUsers.map(async (u) => {
      const nick = genNickname()
      try {
        await usersCollection.where({ openid: u.openid }).update({ data: { nickName: nick } })
        u.nickName = nick
      } catch (e) { /* 写库失败则本次仍显示未设置 */ }
    }))
  }

  const users = usersResult.data.map(u => {
    // 保留天数统一由 _shared/retention.js 计算，避免与 getRetention 逻辑分叉
    const effectiveDays = calcRetentionDays(u)
    const role = u.role || 'user'

    return {
      openid: u.openid,
      role: role,
      roleLabel: ROLES[role]?.label || '普通用户',
      nickName: u.nickName || '',
      avatarUrl: processAvatarUrl(u.avatarUrl),
      createdAt: getCreateTime(u) || new Date().toISOString(),
      vipExpiresAt: u.vipExpiresAt || '',
      retentionDays: effectiveDays,     // 有效保留天数（页面直接使用）
      historyRetentionDays: effectiveDays // 兼容旧字段名
    }
  })

  return {
    success: true,
    total: countResult.total,
    page: pageNum,
    pageSize: sizeNum,
    // 全量角色统计：供后台顶部统计卡展示
    stats: {
      admin: adminCount.total,
      vip: vipCount.total,
      user: userCount.total,
      blocked: blockedCount.total
    },
    users: users
  }
}

// 检查权限等级
async function checkPermission(openid, requiredLevel, usersCollection) {
  const { data } = await usersCollection.where({ openid }).get()
  if (!data.length) {
    return { success: false, hasPermission: false, error: '用户不存在' }
  }

  const user = data[0]
  // 检查VIP过期（过期会自动降级）
  const vipResult = await checkVipExpiry(user, usersCollection)
  const level = vipResult.level

  return { success: true, hasPermission: level >= requiredLevel, role: vipResult.role, level }
}
