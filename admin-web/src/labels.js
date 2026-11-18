/**
 * 后台通用文案与配色映射
 * 单一来源：避免同一角色在不同页面出现不一致的标签颜色/名称
 */

/** 用户角色 */
const ROLE_LABEL = { user: '普通', vip: 'VIP', admin: '管理员', blocked: '已封禁' }
const ROLE_THEME = { user: 'default', vip: 'warning', admin: 'primary', blocked: 'danger' }

export function roleLabel(role) {
  return ROLE_LABEL[role] || role || '-'
}

export function roleTheme(role) {
  return ROLE_THEME[role] || 'default'
}

/** 互助任务状态 */
const STATUS_TEXT = {
  ongoing: '进行中',
  pending: '待核对',
  done: '已成功',
  returned: '已放回'
}

export function statusText(status) {
  return STATUS_TEXT[status] || status || '-'
}

/** 互助任务模式 */
export function modeText(mode) {
  return mode === 'team' ? '车队' : '个人'
}
