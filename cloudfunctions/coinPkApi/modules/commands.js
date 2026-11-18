/**
 * 口令池：读 / 发布 / 抽取 / 回报 / 确认
 */
const { db, _, ACCOUNT_COLLECTION, COMMAND_COLLECTION, RECORD_COLLECTION, QUOTA_COLLECTION, USERS_COLLECTION, ensureCollection } = require('../context')
const { todayKey } = require('../_shared/time')
const { getLimits, getQuotaBalance } = require('./quota')
const { getDailyStats, getDailyDoc, bumpHelpUsed } = require('./daily')
const { settleExpiredSubmitted } = require('./records')

/** 已领取但未回报的任务超过该时长视为异常残留，允许重新进入口令池 */
const TASK_STALE_MS = 6 * 60 * 1000

/** 校验本人是否已登记资料（有昵称）——未登记不能参与口令互助 */
async function isRegistered(openid, toolKey) {
  try {
    const { data } = await db.collection(ACCOUNT_COLLECTION)
      .where({ owner_openid: openid, tool_key: toolKey })
      .limit(1).get()
    return !!(data.length && data[0].tb_nick)
  } catch (e) {
    console.warn('[coinPkApi] 登记校验失败', e)
    return false
  }
}

/**
 * 读取本人今天的口令（两个模式各一条）
 * 非当天记录不返回，并在后台清理
 */
async function getCommands(openid, toolKey) {
  // 先结算超时未确认的待核对任务（受助次数此时才计入）
  await settleExpiredSubmitted(openid, toolKey)
  const date = todayKey()
  const col = db.collection(COMMAND_COLLECTION)

  const { data } = await col.where({
    owner_openid: openid,
    tool_key: toolKey,
    date
  }).limit(10).get()

  const commands = { solo: '', team: '' }
  data.forEach((doc) => {
    if (doc.mode === 'solo' || doc.mode === 'team') {
      commands[doc.mode] = doc.command || ''
    }
  })

  // 发布者当天已成功受助数（status=done 的口令数）= 「已安排」次数
  const receive_done = { solo: 0, team: 0 }
  try {
    const { data: doneDocs } = await col.where({
      owner_openid: openid,
      tool_key: toolKey,
      date,
      status: 'done'
    }).limit(100).get()
    doneDocs.forEach((doc) => {
      if (receive_done[doc.mode] !== undefined) receive_done[doc.mode]++
    })
  } catch (e) {
    console.warn('[coinPkApi] 受助统计失败', e)
  }

  // 清理该用户该工具的历史口令（只保留当天）
  try {
    const { data: stale } = await col.where({
      owner_openid: openid,
      tool_key: toolKey,
      date: db.command.neq(date)
    }).limit(100).get()
    for (const doc of stale) {
      await col.doc(doc._id).remove()
    }
  } catch (e) {
    console.warn('[coinPkApi] 历史口令清理失败', e)
  }

  // 受助机会余额（跨天结转，可为负）
  let quota = { solo: 0, team: 0 }
  try {
    quota = await getQuotaBalance(openid, toolKey)
  } catch (e) {
    console.warn('[coinPkApi] 受助机会读取失败', e)
  }

  // 当天助人次数（云端保存，只当天有效）
  let help_used = { solo: 0, team: 0 }
  try {
    const stats = await getDailyStats(openid, toolKey)
    if (stats.success) help_used = stats.help_used
  } catch (e) {
    console.warn('[coinPkApi] 次数读取失败', e)
  }

  return { success: true, date, commands, receive_done, help_used, quota }
}

/**
 * 更新今天的口令：存在则覆盖，不存在则新建；留空即删除（支持更新/撤回）
 */
async function saveCommand(openid, toolKey, mode, command) {
  if (mode !== 'solo' && mode !== 'team') {
    return { success: false, error: 'INVALID_MODE' }
  }

  // 未登记不能发布口令（清空口令不受限）
  if (String(command || '').trim() && !(await isRegistered(openid, toolKey))) {
    return { success: false, error: 'NOT_REGISTERED' }
  }

  const date = todayKey()
  const value = String(command || '').trim().replace(/[\u0000-\u001f]/g, '').slice(0, 200)
  const col = db.collection(COMMAND_COLLECTION)

  // 内容校验：太短视为无效口令，避免垃圾内容进池
  if (value && value.length < 5) {
    return { success: false, error: 'INVALID_COMMAND' }
  }

  const { data } = await col.where({
    owner_openid: openid,
    tool_key: toolKey,
    mode,
    date
  }).limit(1).get()

  if (!value) {
    if (data.length) await col.doc(data[0]._id).remove()
    return { success: true, date, mode, command: '' }
  }

  // 先助人、后发布：受助机会余额必须 >= 1（注册赠 1，助力 +1，被助力 -1，负数为亏欠）
  if (!data.length) {
    try {
      const quota = await getQuotaBalance(openid, toolKey)
      const balance = mode === 'solo' ? quota.solo : quota.team
      if (balance < 1) {
        return { success: false, error: 'NEED_HELP_FIRST', quota: balance }
      }
    } catch (e) {
      console.warn('[coinPkApi] 发布门槛校验失败', e)
    }
  }

  if (data.length) {
    // 口令正被他人领取时不允许改写，避免在途任务信息错乱
    if (data[0].status === 'drawn') {
      return { success: false, error: 'BUSY' }
    }
    await col.doc(data[0]._id).update({
      data: {
        command: value,
        status: 'available', // 内容变更后重新进入口令池
        updatedAt: new Date().toISOString()
      }
    })
  } else {
    await col.add({
      data: {
        owner_openid: openid,
        tool_key: toolKey,
        mode,
        date,
        command: value,
        status: 'available',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    })
  }

  return { success: true, date, mode, command: value }
}
/**
 * 领取口令：从当天同模式口令池随机抽一条非本人的口令
 * 口令状态：available 可抽 / drawn 被领取进行中 / done 已完成永久出池
 * exclude_nicks：前端黑名单 + 刚释放任务的昵称，避免重复抽到
 */
async function drawCommand(openid, toolKey, mode, excludeNicks) {
  if (mode !== 'solo' && mode !== 'team') {
    return { success: false, error: 'INVALID_MODE' }
  }

  // 未登记不能领取；顺便取本人昵称用于发布者的受助记录
  let myNick = ''
  try {
    const { data: mine } = await db.collection(ACCOUNT_COLLECTION)
      .where({ owner_openid: openid, tool_key: toolKey })
      .limit(1).get()
    if (mine.length && mine[0].tb_nick) {
      myNick = mine[0].tb_nick
    }
  } catch (e) {
    console.warn('[coinPkApi] 登记校验失败', e)
  }
  if (!myNick) {
    return { success: false, error: 'NOT_REGISTERED' }
  }

  const date = todayKey()
  const col = db.collection(COMMAND_COLLECTION)

  // 助人次数云端校验（前端可被绕过，必须服务端把关）
  const limits = await getLimits(toolKey, mode)
  const dailyDoc = await getDailyDoc(openid, toolKey, date)
  const usedNow = Number(dailyDoc && (mode === 'solo' ? dailyDoc.help_used_solo : dailyDoc.help_used_team)) || 0
  if (usedNow >= limits.help) {
    return { success: false, error: 'LIMIT_REACHED' }
  }

  // 任务有效期按工具配置，残留回收时间比任务时长多 1 分钟缓冲
  const staleMs = Math.max(TASK_STALE_MS, (limits.taskSeconds || 300) * 1000 + 60 * 1000)
  const staleBefore = new Date(Date.now() - staleMs).toISOString()

  const base = {
    owner_openid: _.neq(openid),
    tool_key: toolKey,
    mode,
    date,
    // 同一人领取过的口令不再重复领取（退池后其他人仍可抽到）
    helped_openids: _.nin([openid])
  }
  const { data } = await col.where(_.or([
    { ...base, status: _.exists(false) },
    { ...base, status: 'available' },
    { ...base, status: 'drawn', drawn_at: _.lt(staleBefore) }
  ])).limit(50).get()

  if (!data.length) {
    return { success: true, matched: false }
  }

  // 发布者展示资料
  let byOpenid = {}
  try {
    const { data: accounts } = await db.collection(ACCOUNT_COLLECTION)
      .where({ tool_key: toolKey })
      .limit(200)
      .get()
    accounts.forEach((a) => { byOpenid[a.owner_openid] = a })
  } catch (e) {
    console.warn('[coinPkApi] 发布者资料读取失败', e)
  }

  // 发布者当天已占用名额（已确认 + 待核对），满额的口令不再参与抽取
  const doneByOwner = {}
  try {
    const $ = db.command.aggregate
    const aggRes = await col.aggregate()
      .match({ tool_key: toolKey, mode, date, status: _.in(['done', 'submitted']) })
      .group({ _id: '$owner_openid', n: $.sum(1) })
      .end()
    ;(aggRes.list || []).forEach((r) => { doneByOwner[r._id] = r.n })
  } catch (e) {
    console.warn('[coinPkApi] 受助统计失败', e)
  }

  const isTeamMode = mode === 'team'

  // 发布者受助机会（余额 < 1 即亏欠）→ 其口令不参与抽取，避免超支用户占池
  const quotaMap = {}
  try {
    const owners = [...new Set(data.map((d) => d.owner_openid).filter(Boolean))]
    if (owners.length) {
      const { data: qdocs } = await db.collection(QUOTA_COLLECTION)
        .where({ owner_openid: db.command.in(owners), tool_key: toolKey })
        .limit(100).get()
      const field = isTeamMode ? 'balance_team' : 'balance_solo'
      qdocs.forEach((q) => {
        // 余额原样读取（不按天补充）；无账本说明从未发布过口令，不会出现在候选里
        quotaMap[q.owner_openid] = (Number(q[field]) || 0)
      })
    }
  } catch (e) {
    console.warn('[coinPkApi] 受助机会批量读取失败', e)
  }
  // 后台已封禁的发布者：其口令不再被他人抽到
  const blockedOwners = new Set()
  try {
    const owners = [...new Set(data.map((d) => d.owner_openid).filter(Boolean))]
    if (owners.length) {
      const { data: bs } = await db.collection(USERS_COLLECTION)
        .where({ openid: _.in(owners), role: 'blocked' })
        .limit(100)
        .get()
      bs.forEach((b) => blockedOwners.add(b.openid))
    }
  } catch (e) {
    console.warn('[coinPkApi] 封禁发布者过滤失败', e)
  }

  const exclude = new Set(Array.isArray(excludeNicks) ? excludeNicks : [])
  const candidates = data.filter((d) => {
    if (!d.command) return false
    if (blockedOwners.has(d.owner_openid)) return false
    const acc = byOpenid[d.owner_openid] || {}
    // 发布者已暂停该模式受助 → 口令不参与抽取
    if (isTeamMode ? acc.paused_team : acc.paused_solo) return false
    // 发布者受助机会不足（亏欠）→ 不参与抽取
    const q = quotaMap[d.owner_openid]
    if (q !== undefined && q < 1) return false
    // 受助名额：取「本人设置」与「工具上限」的较小值，两者都不可突破
    const ownQuota = isTeamMode ? acc.quota_team : acc.quota_solo
    const cap = Math.min(
      typeof ownQuota === 'number' && ownQuota > 0 ? ownQuota : limits.receive,
      limits.receive
    )
    if ((doneByOwner[d.owner_openid] || 0) >= cap) return false
    return !exclude.has(acc.tb_nick || '')
  })

  if (!candidates.length) {
    return { success: true, matched: false }
  }

  const picked = candidates[Math.floor(Math.random() * candidates.length)]

  // 这条口令是否从超时未回报的旧持有者手里回收
  const prevHolder = picked.holder_openid || ''
  const prevStale = picked.status === 'drawn' && !!picked.drawn_at && String(picked.drawn_at) < staleBefore

  // 标记占用：仅可占用未被领取/已回池/超时残留的口令
  // 已提交待核对（submitted）与已完成（done）的口令绝不能被二次领取
  const claim = await col.where(_.and([
    { _id: picked._id },
    _.or([
      { status: _.exists(false) },
      { status: 'available' },
      { status: 'drawn' }
    ])
  ])).update({
    data: {
      status: 'drawn',
      holder_openid: openid,
      drawn_at: new Date().toISOString(),
      helped_openids: _.push([openid])
    }
  })
  if (!claim.stats || claim.stats.updated === 0) {
    return { success: true, matched: false }
  }

  // 领取成功即扣 1 次助人（云端唯一扣减点）
  await bumpHelpUsed(openid, toolKey, mode, 1)
  // 回收超时任务时，旧持有者未回报的次数退回，避免次数被吞
  if (prevHolder && prevHolder !== openid && prevStale) {
    await bumpHelpUsed(prevHolder, toolKey, mode, -1)
    // 旧持有者的进行中记录也一并了结
    try {
      const recCol = db.collection(RECORD_COLLECTION)
      await recCol.where({ command_id: picked._id, type: 'help', status: 'ongoing' })
        .update({ data: { status: 'returned' } })
      await recCol.where({ command_id: picked._id, type: 'receive', status: 'ongoing' })
        .remove()
    } catch (e) { console.warn('[coinPkApi] 旧任务记录清理失败', e) }
  }

  const acc = byOpenid[picked.owner_openid] || {}
  const now = new Date().toISOString()

  // 云端记录：助人（领取者）+ 受助（发布者），完成/退回时同步状态
  try {
    await ensureCollection(RECORD_COLLECTION)
    const recCol = db.collection(RECORD_COLLECTION)
    const recBase = {
      tool_key: toolKey,
      mode,
      date,
      command_id: picked._id,
      command: picked.command,
      status: 'ongoing',
      created_at: now
    }
    await recCol.add({ data: { ...recBase, owner_openid: openid, type: 'help', nick: acc.tb_nick || '淘友' } })
    await recCol.add({ data: { ...recBase, owner_openid: picked.owner_openid, type: 'receive', nick: myNick } })
  } catch (e) {
    console.warn('[coinPkApi] 记录写入失败', e)
  }

  return {
    success: true,
    matched: true,
    task: {
      task_id: picked._id,
      command: picked.command,
      nick: acc.tb_nick || '淘友',
      avatar_url: acc.avatar_url || '',
      site_no: acc.site_no || 0
    }
  }
}
/**
 * 回报任务结果：
 * - submitted：助力方提交结果（车队必须带截图），等待受助方核对
 * - available：退回池中（失败/超时/换一个）
 * 助力方不能直接把状态改成 done，必须由受助方确认或超时自动通过
 */
async function setCommandStatus(openid, taskId, status, proofFileId) {
  if (status !== 'submitted' && status !== 'available') {
    return { success: false, error: 'INVALID_STATUS' }
  }

  const col = db.collection(COMMAND_COLLECTION)
  let doc = null
  try {
    const res = await col.doc(taskId).get()
    doc = res.data
  } catch (e) {
    return { success: false, error: 'NOT_FOUND' }
  }

  if (!doc || doc.holder_openid !== openid) {
    return { success: false, error: 'FORBIDDEN' }
  }

  // 已提交待核对的任务不能退回池中（已实际助力过，只能等核对/自动通过）
  if (status === 'available' && (doc.status === 'submitted' || doc.status === 'done')) {
    return { success: false, error: 'ALREADY_SUBMITTED' }
  }

  const data = { status, updatedAt: new Date().toISOString() }
  if (status === 'available') {
    data.holder_openid = ''
    data.drawn_at = ''
    // 退回即退次数（云端唯一退还点；重复调用会因 holder 已清空而 FORBIDDEN，不会多退）
    if (doc.status === 'drawn') {
      await bumpHelpUsed(openid, doc.tool_key, doc.mode, -1)
    }
  }
  if (status === 'submitted') {
    if (doc.status === 'submitted') {
      return { success: false, error: 'ALREADY_SUBMITTED' }
    }
    // 车队助力必须上传截图凭证
    const proof = String(proofFileId || '').trim().slice(0, 300)
    if (doc.mode === 'team' && !proof) {
      return { success: false, error: 'PROOF_REQUIRED' }
    }
    data.status = 'submitted'
    data.submitted_at = new Date().toISOString()
    if (proof) data.proof_file_id = proof
  }
  await col.doc(taskId).update({ data })

  // 同步互助记录：submitted → 两边置「待核对」；退回 → 助人记录标已放回、删除受助记录
  try {
    const recCol = db.collection(RECORD_COLLECTION)
    if (status === 'submitted') {
      const proof = String(proofFileId || '').trim().slice(0, 300)
      const recPatch = { status: 'pending' }
      if (proof) recPatch.proof_file_id = proof
      await recCol.where({ command_id: taskId, type: 'help', status: 'ongoing' })
        .update({ data: recPatch })
      await recCol.where({ command_id: taskId, type: 'receive', status: 'ongoing' })
        .update({ data: { status: 'pending' } })
    } else {
      await recCol.where({ command_id: taskId, type: 'help', status: 'ongoing' })
        .update({ data: { status: 'returned' } })
      await recCol.where({ command_id: taskId, type: 'receive', status: 'ongoing' })
        .remove()
    }
  } catch (e) {
    console.warn('[coinPkApi] 记录状态同步失败', e)
  }

  return { success: true, status }
}

/** 受助方核对确认：submitted → done（受助次数由此计入） */
async function confirmReceive(openid, taskId) {
  const { applyQuotaOnDone } = require('./quota')
  const col = db.collection(COMMAND_COLLECTION)
  let doc = null
  try {
    const res = await col.doc(taskId).get()
    doc = res.data
  } catch (e) {
    return { success: false, error: 'NOT_FOUND' }
  }
  if (!doc || doc.owner_openid !== openid) {
    return { success: false, error: 'FORBIDDEN' }
  }
  if (doc.status !== 'submitted') {
    return { success: false, error: 'INVALID_STATUS' }
  }

  const now = new Date().toISOString()
  await col.doc(taskId).update({ data: { status: 'done', done_at: now, updatedAt: now } })

  // 额度结算：助力方 +1 受助机会，发布方 -1
  await applyQuotaOnDone(doc)

  try {
    const recCol = db.collection(RECORD_COLLECTION)
    await recCol.where({ command_id: taskId, type: 'help', status: 'pending' })
      .update({ data: { status: 'done' } })
    await recCol.where({ command_id: taskId, type: 'receive', status: 'pending' })
      .update({ data: { status: 'done' } })
  } catch (e) {
    console.warn('[coinPkApi] 确认后记录同步失败', e)
  }

  return { success: true }
}

module.exports = { TASK_STALE_MS, isRegistered, getCommands, saveCommand, drawCommand, setCommandStatus, confirmReceive }