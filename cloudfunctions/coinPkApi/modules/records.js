/**
 * 互助记录：待核对超时自动通过 + 记录查询校正
 */
const { db, _, COMMAND_COLLECTION, RECORD_COLLECTION, ensureCollection } = require('../context')
const { applyQuotaOnDone } = require('./quota')

/** 待核对自动通过窗口：10 分钟未确认视为通过（防受助方赖着不确认） */
const CONFIRM_WINDOW_MS = 10 * 60 * 1000

/**
 * 待核对超时自动通过：10 分钟内未确认则视为通过
 * 双方任意一方上线（查次数/查记录）都会触发，防止任何一方赖着不确认
 */
async function settleExpiredSubmitted(openid, toolKey) {
  try {
    const col = db.collection(COMMAND_COLLECTION)
    const before = new Date(Date.now() - CONFIRM_WINDOW_MS).toISOString()
    const base = {
      tool_key: toolKey,
      status: 'submitted',
      submitted_at: _.lt(before)
    }
    // 本人发布的（受助方视角）+ 本人领取的（助力方视角）
    const [ownRes, heldRes] = await Promise.all([
      col.where({ ...base, owner_openid: openid }).limit(4).get(),
      col.where({ ...base, holder_openid: openid }).limit(4).get()
    ])
    const targets = [...(ownRes.data || []), ...(heldRes.data || [])]
    if (!targets.length) return

    const recCol = db.collection(RECORD_COLLECTION)
    const now = new Date().toISOString()
    const seen = new Set()
    for (const d of targets) {
      // 单次最多结算 5 条，控制云函数耗时；剩余的下次调用继续
      if (seen.size >= 5) break
      if (seen.has(d._id)) continue
      seen.add(d._id)
      try {
        await col.doc(d._id).update({ data: { status: 'done', done_at: now, updatedAt: now } })
        await applyQuotaOnDone(d)
        await recCol.where({ command_id: d._id, status: 'pending' })
          .update({ data: { status: 'done' } })
      } catch (e) { /* 单条失败不影响其它 */ }
    }
  } catch (e) {
    console.warn('[coinPkApi] 待核对自动通过失败', e)
  }
}

/** 读取本人互助记录（助人/受助，跨天保留，最近 50 条） */
async function getRecords(openid, toolKey, mode, type) {
  if (mode !== 'solo' && mode !== 'team') {
    return { success: false, error: 'INVALID_MODE' }
  }
  if (type !== 'help' && type !== 'receive') {
    return { success: false, error: 'INVALID_TYPE' }
  }

  await ensureCollection(RECORD_COLLECTION)
  const recCol = db.collection(RECORD_COLLECTION)

  // 先结算超时未确认的待核对任务（双方任意一方查看记录都会触发）
  await settleExpiredSubmitted(openid, toolKey)

  // 状态校正：任务有效期 5 分钟 + 6 分钟残留回池，超 12 分钟仍是进行中的必然已中断
  // （用户杀小程序/回报丢失）。助人记录标已放回；发布者的受助记录删除。
  try {
    const staleBefore = new Date(Date.now() - 12 * 60 * 1000).toISOString()
    await recCol.where({
      owner_openid: openid, tool_key: toolKey, mode, type: 'help',
      status: 'ongoing', created_at: _.lt(staleBefore)
    }).update({ data: { status: 'returned' } })
    await recCol.where({
      owner_openid: openid, tool_key: toolKey, mode, type: 'receive',
      status: 'ongoing', created_at: _.lt(staleBefore)
    }).remove()
    // 顺带清理 30 天前的历史记录
    const oldBefore = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
    await recCol.where({ owner_openid: openid, created_at: _.lt(oldBefore) }).remove()
  } catch (e) {
    console.warn('[coinPkApi] 记录校正失败', e)
  }

  const { data } = await recCol
    .where({ owner_openid: openid, tool_key: toolKey, mode, type })
    .orderBy('created_at', 'desc')
    .limit(50)
    .get()

  return { success: true, records: data }
}

module.exports = { CONFIRM_WINDOW_MS, settleExpiredSubmitted, getRecords }