// 配置常量
const USER_ROLES = {
  ADMIN: 'admin',
  VIP: 'vip',
  USER: 'user',
  BLOCKED: 'blocked'
}

const ROLE_LABELS = {
  [USER_ROLES.ADMIN]: '管理员',
  [USER_ROLES.VIP]: 'VIP用户',
  [USER_ROLES.USER]: '普通用户',
  [USER_ROLES.BLOCKED]: '已封禁'
}

const STORAGE_KEYS = {
  IS_LOGGED_IN: 'isLoggedIn',
  USER_AVATAR: 'userAvatar',
  USER_NICKNAME: 'userNickName'
}

const CLOUD_FUNCTIONS = {
  USER_MANAGE: 'userManage'
}

module.exports = {
  USER_ROLES,
  ROLE_LABELS,
  STORAGE_KEYS,
  CLOUD_FUNCTIONS
}