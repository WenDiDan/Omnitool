/**
 * 云函数公共数据库工具
 *
 * 说明：由 scripts/sync-cloud-shared.js 复制到各函数的 _shared/ 目录，
 * 修改后执行 `npm run sync:cloud` 重新同步。
 */

/**
 * 确保集合存在（不存在则创建）
 * @param {object} db cloud.database() 实例（各函数自行初始化，便于复用）
 * @param {string} name 集合名
 * @param {string} [tag] 日志前缀，便于定位是哪个函数失败
 * @returns {Promise<boolean>}
 */
async function ensureCollection(db, name, tag = 'shared') {
  try {
    await db.collection(name).count()
    return true
  } catch (e) {
    try {
      await db.createCollection(name)
      return true
    } catch (e2) {
      console.error(`[${tag}] 创建集合失败`, name, e2 && e2.message)
      return false
    }
  }
}

module.exports = {
  ensureCollection
}
