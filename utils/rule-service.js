/**
 * 自定义解码规则服务
 *
 * 负责规则列表的增删改查与持久化，并把规则交给 utils/decode-rules.js 执行。
 * 页面通过 app 的同名方法调用，保持既有 API 不变。
 */

const decodeRules = require('./decode-rules.js')

/** 读取当前规则列表（无数据时返回空数组） */
function getCustomRules(globalData) {
  return (globalData && globalData.customRules) || []
}

/** 持久化规则列表 */
function persist(globalData, rules) {
  globalData.customRules = rules
  wx.setStorageSync('customRules', rules)
  return rules
}

/**
 * 新增规则（置顶）
 * @param {object} globalData
 * @param {object} rule 规则内容，id 与创建时间由本方法生成
 */
function addCustomRule(globalData, rule) {
  const rules = getCustomRules(globalData)
  rules.unshift({
    ...rule,
    id: Date.now().toString(),
    createdAt: new Date().toLocaleString()
  })
  return persist(globalData, rules)
}

/** 删除规则 */
function deleteCustomRule(globalData, id) {
  const rules = getCustomRules(globalData).filter((r) => r.id !== id)
  return persist(globalData, rules)
}

/** 更新规则字段（不存在的 id 静默忽略） */
function updateCustomRule(globalData, id, updates) {
  const rules = getCustomRules(globalData)
  const index = rules.findIndex((r) => r.id === id)
  if (index !== -1) {
    rules[index] = { ...rules[index], ...updates }
    return persist(globalData, rules)
  }
  return rules
}

/** 只读的日期代码映射表（真实状态由 decode-rules 维护） */
function getDateCodeMaps() {
  return decodeRules.getMaps()
}

/** 更新自定义日期映射 */
function updateDateMapping(customMapping) {
  return decodeRules.updateDateMapping(customMapping)
}

/** 字母/数字 → 日期数值 */
function convertLetterToDate(char) {
  return decodeRules.convertLetterToDate(char)
}

/** 使用启用中的规则解码内容 */
function decodeWithRule(globalData, code) {
  return decodeRules.decodeWithRule(code, getCustomRules(globalData))
}

module.exports = {
  getCustomRules,
  addCustomRule,
  deleteCustomRule,
  updateCustomRule,
  getDateCodeMaps,
  updateDateMapping,
  convertLetterToDate,
  decodeWithRule
}
