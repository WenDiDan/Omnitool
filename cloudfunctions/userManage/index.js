const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

// 角色定义
const ROLES = {
  admin: { label: '管理员', level: 3 },
  vip: { label: 'VIP用户', level: 2 },
  user: { label: '普通用户', level: 1 },
  blocked: { label: '已封禁', level: 0 }
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { action } = event

  // 安全检查：小程序调用时必有 OPENID
  if (!OPENID) {
    return { success: false, error: '未获取到用户身份，请确保在小程序中调用' }
  }

  const usersCollection = db.collection('users')

  switch (action) {
    case 'getInfo':
      return await getUserInfo(OPENID, usersCollection)
    case 'updateProfile':
      return await updateProfile(OPENID, event.nickName, event.avatarUrl, usersCollection)
    case 'setRole':
      return await setRole(OPENID, event.targetOpenid, event.role, usersCollection)
    case 'listUsers':
      return await listUsers(OPENID, event.page || 1, event.pageSize || 20, usersCollection)
    case 'checkPermission':
      return await checkPermission(OPENID, event.requiredLevel || 1, usersCollection)
    default:
      return { success: false, error: '未知操作' }
  }
}

// 获取当前用户信息，不存在则自动创建
async function getUserInfo(openid, usersCollection) {
  try {
    const { data } = await usersCollection.where({ openid }).get()
    if (data.length > 0) {
      const user = data.find(u => u.openid === openid) || data[0]
      return {
        success: true,
        user: {
          openid,
          role: user.role || 'user',
          roleLabel: ROLES[user.role]?.label || '普通用户',
          level: ROLES[user.role]?.level || 1,
          nickName: user.nickName || '',
          avatarUrl: user.avatarUrl || '',
          createdAt: user.createdAt
        }
      }
    }

    return await createUser(openid, usersCollection)
  } catch (err) {
    // 集合可能不存在，尝试创建后重试
    if (err.errCode === -502005) {
      try { await db.createCollection('users') } catch (e) { /* 忽略 */ }
      return await createUser(openid, usersCollection)
    }
    return { success: false, error: err.message || String(err) }
  }
}

async function createUser(openid, usersCollection) {
  const now = new Date().toISOString()

  // 创建用户记录
  await usersCollection.add({
    data: { openid, role: 'user', nickName: '', avatarUrl: '', createdAt: now }
  })

  // 检查是否是第一个用户，自动设为管理员
  try {
    const countResult = await usersCollection.where({
      openid: db.RegExp({ regexp: '.+' })
    }).count()

    if (countResult.total <= 1) {
      await usersCollection.where({ openid }).update({ data: { role: 'admin' } })
      return {
        success: true,
        user: { openid, role: 'admin', roleLabel: '管理员', level: 3, nickName: '', avatarUrl: '', createdAt: now }
      }
    }
  } catch (e) {
    // count 查询失败时默认为普通用户
    console.error('统计用户数量失败', e)
  }

  return {
    success: true,
    user: { openid, role: 'user', roleLabel: '普通用户', level: 1, nickName: '', avatarUrl: '', createdAt: now }
  }
}

// 更新用户资料（昵称、头像）
async function updateProfile(openid, nickName, avatarUrl, usersCollection) {
  const data = {}
  if (nickName !== undefined) data.nickName = nickName
  if (avatarUrl !== undefined) data.avatarUrl = avatarUrl
  if (Object.keys(data).length === 0) {
    return { success: false, error: '无更新内容' }
  }

  await usersCollection.where({ openid }).update({ data })
  return { success: true }
}

// 管理员设置用户角色
async function setRole(callerOpenid, targetOpenid, role, usersCollection) {
  if (!targetOpenid || !role || !ROLES[role]) {
    return { success: false, error: '参数无效' }
  }

  const { data: callerData } = await usersCollection.where({ openid: callerOpenid }).get()
  if (!callerData.length || callerData[0].role !== 'admin') {
    return { success: false, error: '权限不足，仅管理员可操作' }
  }

  if (callerOpenid === targetOpenid && role !== 'admin') {
    return { success: false, error: '不能修改自己的角色' }
  }

  // 防止最后一个管理员被降级
  if (role !== 'admin') {
    const adminCount = (await usersCollection.where({ role: 'admin' }).count()).total
    const { data: targetData } = await usersCollection.where({ openid: targetOpenid }).get()
    if (adminCount <= 1 && targetData.length && targetData[0].role === 'admin') {
      return { success: false, error: '不能降级最后一个管理员' }
    }
  }

  await usersCollection.where({ openid: targetOpenid }).update({
    data: { role }
  })

  return { success: true, message: `已将用户角色设为${ROLES[role].label}` }
}

// 管理员列出所有用户
async function listUsers(callerOpenid, page, pageSize, usersCollection) {
  const { data: callerData } = await usersCollection.where({ openid: callerOpenid }).get()
  if (!callerData.length || callerData[0].role !== 'admin') {
    return { success: false, error: '权限不足，仅管理员可查看' }
  }

  const skip = (page - 1) * pageSize
  const { data: users } = await usersCollection.where({
    openid: db.RegExp({ regexp: '.+' })
  }).skip(skip).limit(pageSize).get()
  const countResult = await usersCollection.where({
    openid: db.RegExp({ regexp: '.+' })
  }).count()

  return {
    success: true,
    total: countResult.total,
    users: users.map(u => ({
      openid: u.openid,
      role: u.role || 'user',
      roleLabel: ROLES[u.role]?.label || '普通用户',
      nickName: u.nickName || '',
      createdAt: u.createdAt
    }))
  }
}

// 检查权限等级
async function checkPermission(openid, requiredLevel, usersCollection) {
  const { data } = await usersCollection.where({ openid }).get()
  if (!data.length) {
    return { success: false, hasPermission: false, error: '用户不存在' }
  }
  const level = ROLES[data[0].role]?.level || 0
  return { success: true, hasPermission: level >= requiredLevel, role: data[0].role, level }
}
