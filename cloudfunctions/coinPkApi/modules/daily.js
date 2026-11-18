/**
 * 每日助人次数：读 / 增减（云端唯一可写入口）
 */
const { db, DAILY_COLLECTION } = require('../context')
const { todayKey } = require('../_shared/time')

/** 读取本人当天的助人次数（跨天自动归零，历史记录清理） */
async function getDailyStats(openid, toolKey) {
  const date = todayKey()
  const col = db.collection(DAILY_COLLECTION)

  const { data } = await col.where({
    owner_openid: openid,
    tool_key: toolKey,
    date
  }).limit(1).get()

  const doc = data[0] || {}

  try {
    const { data: stale } = await col.where({
      owner_openid: openid,
      tool_key: toolKey,
      date: db.command.neq(date)
    }).limit(100).get()
    for (const s of stale) {
      await col.doc(s._id).remove()
    }
  } catch (e) {
    console.warn('[coinPkApi] 历史次数清理失败', e)
  }

  return {
    success: true,
    date,
    help_used: {
      solo: Number(doc.help_used_solo) || 0,
      team: Number(doc.help_used_team) || 0
    }
  }
}

/** 读当天次数文档（不存在返回 null） */
async function getDailyDoc(openid, toolKey, date) {
  const { data } = await db.collection(DAILY_COLLECTION).where({
    owner_openid: openid,
    tool_key: toolKey,
    date
  }).limit(1).get()
  return data[0] || null
}

/** 云端增减助人次数：唯一可写入口（前端不再传绝对值） */
async function bumpHelpUsed(openid, toolKey, mode, delta) {
  const date = todayKey()
  const field = mode === 'solo' ? 'help_used_solo' : 'help_used_team'
  const col = db.collection(DAILY_COLLECTION)
  const doc = await getDailyDoc(openid, toolKey, date)
  const now = new Date().toISOString()

  if (!doc) {
    if (delta <= 0) return 0
    try {
      await col.add({
        data: {
          owner_openid: openid,
          tool_key: toolKey,
          date,
          help_used_solo: 0,
          help_used_team: 0,
          [field]: Math.max(0, delta),
          createdAt: now,
          updatedAt: now
        }
      })
    } catch (e) { console.warn('[coinPkApi] 次数写入失败', e) }
    return Math.max(0, delta)
  }

  const next = Math.max(0, (Number(doc[field]) || 0) + delta)
  try {
    await col.doc(doc._id).update({ data: { [field]: next, updatedAt: now } })
  } catch (e) { console.warn('[coinPkApi] 次数更新失败', e) }
  return next
}

/** 保存本人当天的助人次数（兼容旧版客户端；一律钳到上限内，防止刷次数） */
async function saveDailyStats(openid, toolKey, helpUsed, limitsOf) {
  const date = todayKey()
  const col = db.collection(DAILY_COLLECTION)
  const limitsSolo = await limitsOf(toolKey, 'solo')
  const limitsTeam = await limitsOf(toolKey, 'team')
  const payload = {
    help_used_solo: Math.min(limitsSolo.help, Math.max(0, Number(helpUsed && helpUsed.solo) || 0)),
    help_used_team: Math.min(limitsTeam.help, Math.max(0, Number(helpUsed && helpUsed.team) || 0)),
    updatedAt: new Date().toISOString()
  }

  const { data } = await col.where({
    owner_openid: openid,
    tool_key: toolKey,
    date
  }).limit(1).get()

  if (data.length) {
    await col.doc(data[0]._id).update({ data: payload })
  } else {
    await col.add({
      data: {
        owner_openid: openid,
        tool_key: toolKey,
        date,
        createdAt: new Date().toISOString(),
        ...payload
      }
    })
  }

  return { success: true, date, help_used: { solo: payload.help_used_solo, team: payload.help_used_team } }
}

module.exports = { getDailyStats, getDailyDoc, bumpHelpUsed, saveDailyStats }