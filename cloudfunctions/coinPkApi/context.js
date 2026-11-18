/**
 * coinPkApi 共享上下文：云函数初始化、集合常量、公共校验
 * 业务模块（accounts/commands/daily/quota/records）统一从这里取 db 与常量
 */
const cloud = require('wx-server-sdk')
const { ensureCollection: ensureCollectionShared } = require('./_shared/db')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const COLLECTION = 'tools'
const ACCOUNT_COLLECTION = 'tool_accounts'
const COMMAND_COLLECTION = 'tool_commands'
const RECORD_COLLECTION = 'tool_records'
const QUOTA_COLLECTION = 'tool_quota'
const DAILY_COLLECTION = 'tool_daily'
const USERS_COLLECTION = 'users'

/** 确保集合存在：公共实现见 cloudfunctions/_shared/db.js（部署前同步副本） */
async function ensureCollection(name) {
  return ensureCollectionShared(db, name || COLLECTION, 'coinPkApi')
}

/** 后台封禁（role=blocked）判断：查不到或异常一律按未封禁处理，避免误伤 */
async function isBlockedUser(openid) {
  try {
    const { data } = await db.collection(USERS_COLLECTION).where({ openid }).limit(1).get()
    return !!(data[0] && data[0].role === 'blocked')
  } catch (e) {
    console.warn('[coinPkApi] 封禁状态查询失败', e)
    return false
  }
}

/** 封禁详情：状态 + 原因 + 时间（供前台展示封禁原因） */
async function getBlockInfo(openid) {
  try {
    const { data } = await db.collection(USERS_COLLECTION).where({ openid }).limit(1).get()
    const u = data[0]
    return {
      blocked: !!(u && u.role === 'blocked'),
      reason: (u && u.ban_reason) || '',
      bannedAt: (u && u.bannedAt) || ''
    }
  } catch (e) {
    console.warn('[coinPkApi] 封禁详情查询失败', e)
    return { blocked: false, reason: '', bannedAt: '' }
  }
}

module.exports = {
  cloud,
  db,
  _,
  COLLECTION,
  ACCOUNT_COLLECTION,
  COMMAND_COLLECTION,
  RECORD_COLLECTION,
  QUOTA_COLLECTION,
  DAILY_COLLECTION,
  USERS_COLLECTION,
  ensureCollection,
  isBlockedUser,
  getBlockInfo
}