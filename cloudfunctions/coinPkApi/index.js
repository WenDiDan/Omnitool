/**
 * 淘金币互助业务云函数（tool_key: tb_coin_pk）
 *
 * 按「每个互助工具 = 独立页面 + 独立数据集合 + 独立云函数」模式从 toolsManage 拆出：
 * toolsManage 回归纯工具清单管理，本函数承载全部互助业务，业务集合自建：
 *   tool_accounts  登记资料（tb_nick / 头像 / 暂停与名额设置 / site_no）
 *   tool_commands  口令池（solo / team 两模式，当天有效）
 *   tool_records   互助记录（help / receive）
 *   tool_quota     受助机会账本（跨天结转，可为负）
 *   tool_daily     当天助人次数
 *
 * 动作：
 *   getCommands / saveCommand / drawCommand / updateCommandStatus / confirmReceive
 *   saveDailyStats / getRecords
 *   getAccount / saveAccount / clearAccount / setHelpPause / setHelpQuota
 */
const cloud = require('wx-server-sdk')
const { bjTime } = require('./_shared/time')

const { db, COMMAND_COLLECTION, RECORD_COLLECTION, QUOTA_COLLECTION, DAILY_COLLECTION, ACCOUNT_COLLECTION, ensureCollection, isBlockedUser, getBlockInfo } = require('./context')
const commands = require('./modules/commands')
const accounts = require('./modules/accounts')
const daily = require('./modules/daily')
const records = require('./modules/records')

/** 统一入口：动作分发 */
exports.main = async (event) => {
  const action = event.action || ''
  const openid = cloud.getWXContext().OPENID
  if (!openid) {
    return { success: false, error: 'NO_OPENID' }
  }

  try {
    const toolKey = String(event.tool_key || '').slice(0, 40)

    // 口令与记录类动作：需要口令/记录/次数集合
    if (action === 'getCommands' || action === 'saveCommand' || action === 'drawCommand' || action === 'updateCommandStatus' || action === 'saveDailyStats' || action === 'getRecords') {
      // 后台已封禁的账号：禁止发布口令、领取助力、确认核对、查记录等全部互助操作
      if (await isBlockedUser(openid)) {
        return {
          success: false,
          error: 'ACCOUNT_BLOCKED',
          message: '账号已被封禁，无法使用互助功能，如有疑问请联系客服'
        }
      }

      const ready = await ensureCollection(COMMAND_COLLECTION)
      if (!ready) {
        return { success: false, error: 'COLLECTION_UNAVAILABLE' }
      }
      await ensureCollection(RECORD_COLLECTION)
      await ensureCollection(QUOTA_COLLECTION)

      if (action === 'getCommands') {
        return await commands.getCommands(openid, toolKey)
      }

      if (action === 'drawCommand') {
        return await commands.drawCommand(openid, toolKey, event.mode, event.exclude_nicks)
      }

      if (action === 'updateCommandStatus') {
        return await commands.setCommandStatus(openid, event.task_id, event.status, event.proof_file_id)
      }

      if (action === 'confirmReceive') {
        return await commands.confirmReceive(openid, event.task_id)
      }

      if (action === 'saveDailyStats') {
        const readyDaily = await ensureCollection(DAILY_COLLECTION)
        if (!readyDaily) {
          return { success: false, error: 'COLLECTION_UNAVAILABLE' }
        }
        const { getLimits } = require('./modules/quota')
        return await daily.saveDailyStats(openid, toolKey, event.help_used || {}, getLimits)
      }

      if (action === 'getRecords') {
        const readyRecords = await ensureCollection(RECORD_COLLECTION)
        if (!readyRecords) {
          return { success: false, error: 'COLLECTION_UNAVAILABLE' }
        }
        return await records.getRecords(openid, toolKey, event.mode, event.type)
      }

      return await commands.saveCommand(openid, toolKey, event.mode, event.command)
    }

    // 登记与受助设置类动作
    if (action === 'getAccount' || action === 'saveAccount' || action === 'clearAccount' || action === 'setHelpPause' || action === 'setHelpQuota') {
      const ready = await ensureCollection(ACCOUNT_COLLECTION)
      if (!ready) {
        return { success: false, error: 'COLLECTION_UNAVAILABLE' }
      }

      // 封禁账号：可查询状态（用于前台提示），但禁止改资料/改设置
      const blockInfo = await getBlockInfo(openid)
      const blocked = blockInfo.blocked
      if (blocked && action !== 'getAccount') {
        return {
          success: false,
          error: 'ACCOUNT_BLOCKED',
          message: '账号已被封禁，无法修改资料，如有疑问请联系客服'
        }
      }

      // 兼容早期哈希编号：按登记顺序重排（只在实例内首次执行）
      await accounts.ensureSiteNos()

      if (action === 'getAccount') {
        const account = await accounts.getAccount(openid)
        return {
          success: true,
          account,
          blocked,
          banReason: blocked ? blockInfo.reason : '',
          bannedAt: blocked ? bjTime(blockInfo.bannedAt) : ''
        }
      }

      if (action === 'clearAccount') {
        return await accounts.clearAccount(openid)
      }

      if (action === 'setHelpPause') {
        return await accounts.setHelpPause(openid, toolKey, event.mode, !!event.paused)
      }

      if (action === 'setHelpQuota') {
        return await accounts.setHelpQuota(openid, toolKey, event.mode, event.quota)
      }

      return await accounts.saveAccount(openid, event.account || {})
    }

    return { success: false, error: 'UNKNOWN_ACTION' }
  } catch (e) {
    console.error('[coinPkApi] 操作失败', action, e)
    return { success: false, error: e.message || 'FAILED' }
  }
}