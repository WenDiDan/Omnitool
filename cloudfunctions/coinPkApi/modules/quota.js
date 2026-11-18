/**
 * 工具上限读取 + 受助机会账本（跨天结转，可为负）
 */
const { db, COLLECTION, QUOTA_COLLECTION } = require('../context')
const { todayKey } = require('../_shared/time')

/** 读工具某模式的当天助人/受助上限（个人赛 10/10，车队 PK 6/6 兜底） */
async function getLimits(toolKey, mode) {
  const isTeam = mode === 'team'
  const fallback = { help: isTeam ? 6 : 10, receive: isTeam ? 6 : 10 }
  const norm = (v, def) => (typeof v === 'number' && v > 0 ? v : def)
  try {
    const { data } = await db.collection(COLLECTION).where({ tool_key: toolKey }).limit(1).get()
    const doc = data[0] || {}
    const helpRaw = isTeam ? doc.daily_help_limit_team : doc.daily_help_limit_solo
    const recvRaw = isTeam ? doc.daily_receive_limit_team : doc.daily_receive_limit_solo
    return {
      help: norm(typeof helpRaw === 'number' ? helpRaw : doc.daily_help_limit, fallback.help),
      receive: norm(typeof recvRaw === 'number' ? recvRaw : doc.daily_receive_limit, fallback.receive),
      taskSeconds: norm(doc.task_seconds, 300)
    }
  } catch (e) {
    return { ...fallback, taskSeconds: 300 }
  }
}

/**
 * 受助机会账本（跨天结转，可为负）
 * 规则：注册即赠 1 次；成功助力他人 +1；被他人助力 -1
 * 不会按天自动补充，亏欠（负数）原样结转到次日，需靠继续助力补齐
 */
async function getQuotaBalance(openid, toolKey) {
  const col = db.collection(QUOTA_COLLECTION)
  const today = todayKey()
  let doc = null
  try {
    const { data } = await col.where({ owner_openid: openid, tool_key: toolKey }).limit(1).get()
    doc = data[0] || null
  } catch (e) {
    console.warn('[coinPkApi] 受助机会读取失败', e)
  }

  // 首次建立账本 = 注册赠送 1 次；已有账本则余额原样保留（不按天补充）
  const solo = doc ? (Number(doc.balance_solo) || 0) : 1
  const team = doc ? (Number(doc.balance_team) || 0) : 1

  if (doc) {
    if (doc.last_date !== today) {
      try {
        await col.doc(doc._id).update({
          data: { last_date: today, updatedAt: new Date().toISOString() }
        })
      } catch (e) { /* 忽略 */ }
    }
  } else {
    try {
      await col.add({
        data: {
          owner_openid: openid,
          tool_key: toolKey,
          balance_solo: solo,
          balance_team: team,
          last_date: today,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      })
    } catch (e) { /* 忽略 */ }
  }

  return { solo, team }
}

/** 增减受助机会余额 */
async function bumpQuota(openid, toolKey, mode, delta) {
  if (mode !== 'solo' && mode !== 'team') return 0
  const cur = await getQuotaBalance(openid, toolKey)
  const next = (mode === 'solo' ? cur.solo : cur.team) + delta
  const col = db.collection(QUOTA_COLLECTION)
  try {
    const { data } = await col.where({ owner_openid: openid, tool_key: toolKey }).limit(1).get()
    const field = mode === 'solo' ? 'balance_solo' : 'balance_team'
    if (data.length) {
      await col.doc(data[0]._id).update({
        data: { [field]: next, updatedAt: new Date().toISOString() }
      })
    } else {
      await col.add({
        data: {
          owner_openid: openid,
          tool_key: toolKey,
          balance_solo: mode === 'solo' ? next : 0,
          balance_team: mode === 'team' ? next : 0,
          last_date: todayKey(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      })
    }
  } catch (e) {
    console.warn('[coinPkApi] 受助机会更新失败', e)
  }
  return next
}

/** 助力完成时的额度结算：助力方 +1（获得受助机会），发布方 -1（占用受助名额） */
async function applyQuotaOnDone(doc) {
  if (!doc || (doc.mode !== 'solo' && doc.mode !== 'team')) return
  if (doc.holder_openid) await bumpQuota(doc.holder_openid, doc.tool_key, doc.mode, 1)
  if (doc.owner_openid) await bumpQuota(doc.owner_openid, doc.tool_key, doc.mode, -1)
}

module.exports = { getLimits, getQuotaBalance, bumpQuota, applyQuotaOnDone }