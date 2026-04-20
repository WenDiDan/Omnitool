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

// 检查用户是否被封禁
async function isBlocked(openid, usersCollection) {
  try {
    const { data } = await usersCollection.where({ openid }).get()
    if (data.length === 0) return false
    return data[0].role === 'blocked'
  } catch (e) {
    return false
  }
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { action } = event

  // 安全检查：小程序调用时必有 OPENID
  if (!OPENID) {
    return { success: false, error: '未获取到用户身份，请确保在小程序中调用' }
  }

  const usersCollection = db.collection('users')

  // 封禁用户检查：只有getInfo允许被封禁用户访问
  if (action !== 'getInfo' && action !== 'checkPermission') {
    const blocked = await isBlocked(OPENID, usersCollection)
    if (blocked) {
      return { success: false, error: '您的账号已被封禁，仅能登录' }
    }
  }

  switch (action) {
    case 'getInfo':
      return await getUserInfo(OPENID, usersCollection)
    case 'updateProfile':
      return await updateProfile(OPENID, event.nickName, event.avatarUrl, usersCollection)
    case 'setRole':
      return await setRole(OPENID, event.targetOpenid, event.role, usersCollection)
    case 'deleteUser':
      return await deleteUser(OPENID, event.targetOpenid, usersCollection)
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
          level: ROLES[user.role]?.level ?? 1,
          nickName: user.nickName || '',
          avatarUrl: user.avatarUrl || '',
          avatarVersion: user.avatarVersion || 1,
          createdAt: user.createdAt,
          isBlocked: user.role === 'blocked'
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
    data: { openid, role: 'user', nickName: '', avatarUrl: '', avatarVersion: 1, createdAt: now }
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
        user: { openid, role: 'admin', roleLabel: '管理员', level: 3, nickName: '', avatarUrl: '', avatarVersion: 1, createdAt: now }
      }
    }
  } catch (e) {
    // count 查询失败时默认为普通用户
    console.error('统计用户数量失败', e)
  }

  return {
    success: true,
    user: { openid, role: 'user', roleLabel: '普通用户', level: 1, nickName: '', avatarUrl: '', avatarVersion: 1, createdAt: now }
  }
}

// 更新用户资料（昵称、头像）
async function updateProfile(openid, nickName, avatarUrl, usersCollection) {
  const data = {}
  if (nickName !== undefined) data.nickName = nickName
  if (avatarUrl !== undefined) {
    data.avatarUrl = avatarUrl
    // 如果更新了头像，递增版本号
    const { data: userData } = await usersCollection.where({ openid }).get()
    if (userData.length > 0) {
      const currentVersion = userData[0].avatarVersion || 1
      data.avatarVersion = currentVersion + 1
    }
  }
  if (Object.keys(data).length === 0) {
    return { success: false, error: '无更新内容' }
  }

  await usersCollection.where({ openid }).update({ data })
  return { success: true }
}

// 管理员设置用户角色
async function setRole(callerOpenid, targetOpenid, newRole, usersCollection) {
  // 参数验证：targetOpenid 和 newRole 是必须的
  if (!targetOpenid || !newRole || !ROLES[newRole]) {
    return { success: false, error: '参数无效' }
  }

  // 验证调用者是否是管理员
  const { data: callerData } = await usersCollection.where({ openid: callerOpenid }).get()
  if (!callerData.length || callerData[0].role !== 'admin') {
    return { success: false, error: '权限不足，仅管理员可操作' }
  }

  // 获取目标用户当前信息
  const { data: targetData } = await usersCollection.where({ openid: targetOpenid }).get()
  if (!targetData.length) {
    return { success: false, error: '目标用户不存在' }
  }
  const targetUser = targetData[0]
  const currentRole = targetUser.role || 'user'

  // 防止把最后一个管理员降级（无论是谁操作的）
  if (newRole !== 'admin' && currentRole === 'admin') {
    const adminCount = (await usersCollection.where({ role: 'admin' }).count()).total
    if (adminCount <= 1) {
      return { success: false, error: '不能降级最后一个管理员' }
    }
  }

  // 执行角色更新
  await usersCollection.where({ openid: targetOpenid }).update({
    data: { role: newRole }
  })

  return { success: true, message: `已将用户角色设为${ROLES[newRole].label}` }
}

// 管理员删除用户
async function deleteUser(callerOpenid, targetOpenid, usersCollection) {
  // 参数验证
  if (!targetOpenid) {
    return { success: false, error: '参数无效' }
  }

  // 验证调用者是否是管理员
  const { data: callerData } = await usersCollection.where({ openid: callerOpenid }).get()
  if (!callerData.length || callerData[0].role !== 'admin') {
    return { success: false, error: '权限不足，仅管理员可删除用户' }
  }

  // 不能删除自己
  if (callerOpenid === targetOpenid) {
    return { success: false, error: '不能删除自己' }
  }

  // 获取目标用户信息
  const { data: targetData } = await usersCollection.where({ openid: targetOpenid }).get()
  if (!targetData.length) {
    return { success: false, error: '目标用户不存在' }
  }

  // 如果要删除的是管理员，检查是否是最后一个管理员
  if (targetData[0].role === 'admin') {
    const adminCount = (await usersCollection.where({ role: 'admin' }).count()).total
    if (adminCount <= 1) {
      return { success: false, error: '不能删除最后一个管理员' }
    }
  }

  // 执行删除
  await usersCollection.where({ openid: targetOpenid }).remove()

  return { success: true, message: '用户已删除' }
}

// 管理员列出所有用户
async function listUsers(callerOpenid, page, pageSize, usersCollection) {
  // 验证管理员权限
  const { data: callerData } = await usersCollection.where({ openid: callerOpenid }).get()
  if (!callerData.length || callerData[0].role !== 'admin') {
    return { success: false, error: '权限不足，仅管理员可查看' }
  }

  const skip = (page - 1) * pageSize
  
  // 并行执行查询和统计
  const [usersResult, countResult] = await Promise.all([
    usersCollection.where({
      openid: db.RegExp({ regexp: '.+' })
    }).skip(skip).limit(pageSize).get(),
    usersCollection.where({
      openid: db.RegExp({ regexp: '.+' })
    }).count()
  ])

  // 收集需要转换的云存储头像
  const cloudAvatars = []
  usersResult.data.forEach(u => {
    if (u.avatarUrl && u.avatarUrl.startsWith('cloud://')) {
      cloudAvatars.push({ openid: u.openid, fileID: u.avatarUrl })
    }
  })

  // 批量获取云存储临时URL
  let cloudUrls = {}
  if (cloudAvatars.length > 0) {
    try {
      const fileList = cloudAvatars.map(item => ({ fileID: item.fileID, maxAge: 0 }))
      const urlRes = await cloud.getTempFileURL({ fileList })
      if (urlRes.fileList) {
        urlRes.fileList.forEach(f => {
          if (f.status === 0 && f.tempFileURL) {
            cloudUrls[f.fileID] = f.tempFileURL
          }
        })
      }
    } catch (e) {
      console.error('获取头像URL失败', e)
    }
  }

  // 处理头像URL
  const processAvatarUrl = (url) => {
    if (!url) return ''
    // cloud:// 转临时URL
    if (url.startsWith('cloud://') && cloudUrls[url]) {
      return cloudUrls[url]
    }
    // http 转 https
    if (url.startsWith('http://thirdwx.qlogo.cn') || url.startsWith('http://wx.qlogo.cn')) {
      return url.replace('http://', 'https://')
    }
    return url
  }

  const users = usersResult.data.map(u => ({
    openid: u.openid,
    role: u.role || 'user',
    roleLabel: ROLES[u.role]?.label || '普通用户',
    nickName: u.nickName || '',
    avatarUrl: processAvatarUrl(u.avatarUrl),
    createdAt: u.createdAt || ''
  }))

  return {
    success: true,
    total: countResult.total,
    users: users
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
