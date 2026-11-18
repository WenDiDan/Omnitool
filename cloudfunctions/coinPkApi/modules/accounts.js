/**
 * 登记资料：读 / 登记 / 清除 / 受助暂停与名额设置
 */
const { cloud, db, _, ACCOUNT_COLLECTION, COMMAND_COLLECTION, ensureCollection } = require('../context')
const { todayKey } = require('../_shared/time')
const { getLimits } = require('./quota')

/** 读取当前用户登记的工具账号（按 openid 隔离） */
async function getAccount(openid) {
  const { data } = await db.collection(ACCOUNT_COLLECTION)
    .where({ owner_openid: openid })
    .limit(1)
    .get()
  return data[0] || null
}

/**
 * 本站编号 = 登记顺序（1、2、3…）
 * 云函数实例内只校正一次；按 createdAt 升序重排，兼容早期哈希编号（如 741）
 */
let _siteNosChecked = false
async function ensureSiteNos() {
  if (_siteNosChecked) return
  _siteNosChecked = true

  try {
    const { data } = await db.collection(ACCOUNT_COLLECTION)
      .orderBy('createdAt', 'asc')
      .limit(1000)
      .get()

    for (let i = 0; i < data.length; i++) {
      if (data[i].site_no !== i + 1) {
        await db.collection(ACCOUNT_COLLECTION).doc(data[i]._id).update({
          data: { site_no: i + 1 }
        })
      }
    }
  } catch (e) {
    console.warn('[coinPkApi] 编号校正失败', e)
  }
}

/** 下一个登记序号：当前最大编号 + 1，避免删除/并发导致重复 */
async function nextSiteNo() {
  const { data } = await db.collection(ACCOUNT_COLLECTION)
    .orderBy('site_no', 'desc')
    .limit(1)
    .get()
  const max = data.length && typeof data[0].site_no === 'number' ? data[0].site_no : 0
  return max + 1
}

/** 登记 / 更新展示资料：仅昵称与头像 */
async function saveAccount(openid, input) {
  const payload = {
    tool_key: String(input.tool_key || '').slice(0, 40),
    tb_nick: String(input.tb_nick || '').trim().slice(0, 40),
    avatar_url: String(input.avatar_url || '').trim().slice(0, 300),
    updatedAt: new Date().toISOString()
  }

  if (!payload.tb_nick) {
    return { success: false, error: 'NICK_REQUIRED' }
  }

  const existing = await getAccount(openid)
  if (existing) {
    await db.collection(ACCOUNT_COLLECTION).doc(existing._id).update({ data: payload })
    return {
      success: true,
      account: { ...existing, ...payload, owner_openid: openid }
    }
  }

  const site_no = await nextSiteNo()
  const created = {
    ...payload,
    site_no,
    owner_openid: openid,
    createdAt: payload.updatedAt
  }
  await db.collection(ACCOUNT_COLLECTION).add({ data: created })

  return { success: true, account: created }
}

/** 切换本人某模式的受助暂停（云端生效：暂停后口令不再进入抽取池） */
async function setHelpPause(openid, toolKey, mode, paused) {
  const field = mode === 'solo' ? 'paused_solo' : 'paused_team'
  const col = db.collection(ACCOUNT_COLLECTION)
  const existing = await getAccount(openid)
  if (!existing || existing.tool_key !== toolKey) {
    return { success: false, error: 'NOT_REGISTERED' }
  }
  await col.doc(existing._id).update({
    data: { [field]: !!paused, updatedAt: new Date().toISOString() }
  })
  return { success: true }
}

/** 设置本人某模式当天愿意接受的受助人数（云端生效，不超过工具上限） */
async function setHelpQuota(openid, toolKey, mode, quota) {
  const field = mode === 'solo' ? 'quota_solo' : 'quota_team'
  const limits = await getLimits(toolKey, mode)
  const n = Math.min(limits.receive, Math.max(1, parseInt(quota, 10) || limits.receive))
  const col = db.collection(ACCOUNT_COLLECTION)
  const existing = await getAccount(openid)
  if (!existing || existing.tool_key !== toolKey) {
    return { success: false, error: 'NOT_REGISTERED' }
  }
  await col.doc(existing._id).update({
    data: { [field]: n, updatedAt: new Date().toISOString() }
  })
  return { success: true, quota: n }
}

/**
 * 清除登记资料：删除本人登记文档与已上传头像
 * 仅清理展示资料；未决任务与必要历史记录不在本集合内，不受影响
 */
async function clearAccount(openid) {
  const existing = await getAccount(openid)
  if (!existing) {
    return { success: true, cleared: false }
  }

  const avatarUrl = existing.avatar_url || ''
  await db.collection(ACCOUNT_COLLECTION).doc(existing._id).remove()
  _siteNosChecked = false

  if (avatarUrl.indexOf('cloud://') === 0) {
    try {
      await cloud.deleteFile({ fileList: [avatarUrl] })
    } catch (e) {
      console.warn('[coinPkApi] 头像文件删除失败', e)
    }
  }

  // 同时清除本人当天口令
  try {
    const { data } = await db.collection(COMMAND_COLLECTION)
      .where({ owner_openid: openid, date: todayKey() })
      .limit(100)
      .get()
    for (const doc of data) {
      await db.collection(COMMAND_COLLECTION).doc(doc._id).remove()
    }
  } catch (e) {
    console.warn('[coinPkApi] 口令清除失败', e)
  }

  return { success: true, cleared: true }
}

module.exports = { getAccount, ensureSiteNos, saveAccount, setHelpPause, setHelpQuota, clearAccount }