const app = getApp()

Page({
  data: {
    userList: [],
    userTotal: 0,
    loading: true,
    currentOpenid: '',  // 当前登录用户ID
    adminStatAdmin: 0,
    adminStatVip: 0,
    adminStatUser: 0,
    adminStatBlocked: 0,
    roleOptions: [
      { label: '管理员', value: 'admin' },
      { label: 'VIP用户', value: 'vip' },
      { label: '普通用户', value: 'user' },
      { label: '已封禁', value: 'blocked' }
    ],
    // 删除确认弹窗
    showDeleteModal: false,
    deleteTarget: {
      openid: '',
      nickName: ''
    }
  },

  onLoad() {
    // 获取当前用户openid
    this.setData({
      currentOpenid: wx.getStorageSync('userOpenid') || ''
    })
    this.checkAdminAndLoad()
  },

  onShow() {
    if (!this.data.loading) {
      this.loadUserList()
    }
  },

  // 检查管理员权限并加载数据
  checkAdminAndLoad() {
    this.setData({ loading: true })
    
    wx.cloud.callFunction({
      name: 'userManage',
      data: { action: 'checkPermission', requiredLevel: 3 },
      success: (res) => {
        if (res.result && res.result.hasPermission) {
          this.loadUserList()
        } else {
          this.setData({ loading: false })
          wx.showToast({ title: '权限不足', icon: 'none' })
          setTimeout(() => {
            wx.navigateBack()
          }, 1500)
        }
      },
      fail: () => {
        this.setData({ loading: false })
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    })
  },

  // 加载用户列表
  loadUserList() {
    this.setData({ loading: true })
    
    wx.cloud.callFunction({
      name: 'userManage',
      data: { action: 'listUsers', page: 1, pageSize: 50 },
      success: async (res) => {
        if (res.result && res.result.success) {
          const usersData = res.result.users || []
          const currentOpenid = this.data.currentOpenid
          
          // 预处理用户数据 - 完整显示ID，标记当前用户
          const preparedUsers = usersData.map(user => {
            const openid = user.openid || user._openid || ''
            const isCurrentUser = openid === currentOpenid
            return {
              openid: openid,
              openidDisplay: openid || '---',
              nickName: user.nickName || '微信用户',
              avatarUrl: user.avatarUrl || '',
              role: user.role || 'user',
              roleLabel: this.getRoleLabel(user.role || 'user'),
              createdAt: user.createdAt || user.createTime || '',
              isCurrentUser: isCurrentUser  // 标记当前用户
            }
          })
          
          // 批量获取头像URL
          const users = await this.batchGetAvatarUrls(preparedUsers)
          
          // 统计各角色数量
          const statAdmin = users.filter(u => u.role === 'admin').length
          const statVip = users.filter(u => u.role === 'vip').length
          const statUser = users.filter(u => u.role === 'user').length
          const statBlocked = users.filter(u => u.role === 'blocked').length
          
          this.setData({
            userList: users,
            userTotal: res.result.total || users.length,
            adminStatAdmin: statAdmin,
            adminStatVip: statVip,
            adminStatUser: statUser,
            adminStatBlocked: statBlocked,
            loading: false
          })
        } else {
          this.setData({ loading: false })
          wx.showToast({ title: res.result?.error || '加载失败', icon: 'none' })
        }
      },
      fail: () => {
        this.setData({ loading: false })
        wx.showToast({ title: '网络异常', icon: 'none' })
      }
    })
  },

  // 获取角色标签
  getRoleLabel(role) {
    const labels = {
      admin: '管理员',
      vip: 'VIP用户',
      user: '普通用户',
      blocked: '已封禁'
    }
    return labels[role] || '普通用户'
  },

  // 批量获取头像URL - 使用与my.js相同的逻辑
  async batchGetAvatarUrls(userList) {
    // 先检查是否有本地缓存的头像
    const localAvatar = wx.getStorageSync('userAvatar') || ''
    
    // 为每个用户获取头像URL
    for (let i = 0; i < userList.length; i++) {
      const user = userList[i]
      const originalUrl = user.avatarUrl
      
      // 如果是当前用户，优先使用本地缓存的头像
      if (user.isCurrentUser && localAvatar) {
        user.avatarUrl = await this.getAvatarUrl(localAvatar)
      } else {
        user.avatarUrl = await this.getAvatarUrl(originalUrl)
      }
      
      console.log(`用户 ${user.nickName} 头像: ${originalUrl} -> ${user.avatarUrl}`)
    }
    return userList
  },

  // 获取头像URL - 使用云函数获取（绕过权限限制）
  async getAvatarUrl(avatarUrl) {
    if (!avatarUrl) return '/images/icon_user_white.png'
    
    // 已经是https链接，直接返回
    if (avatarUrl.startsWith('https://')) {
      return avatarUrl
    }
    
    // 微信头像链接
    if (avatarUrl.startsWith('http://thirdwx.qlogo.cn') || avatarUrl.startsWith('http://wx.qlogo.cn')) {
      return avatarUrl.replace('http://', 'https://')
    }
    
    // 云存储cloud://链接 - 通过云函数获取临时URL
    if (avatarUrl.startsWith('cloud://')) {
      try {
        const res = await wx.cloud.callFunction({
          name: 'adminStorage',
          data: {
            action: 'getTempUrl',
            cloudPath: avatarUrl
          }
        })
        console.log('头像获取结果:', res)
        if (res.result && res.result.success && res.result.url) {
          return res.result.url
        } else {
          console.error('头像获取失败:', res.result ? res.result.error : '未知错误')
        }
      } catch (e) {
        console.error('获取头像URL失败:', e)
      }
    }
    
    return '/images/icon_user_white.png'
  },

  // 下拉刷新
  onPullDownRefresh() {
    this.loadUserList()
    setTimeout(() => {
      wx.stopPullDownRefresh()
    }, 500)
  },

  // 复制Openid
  onCopyOpenid(e) {
    const openid = e.currentTarget.dataset.openid
    wx.setClipboardData({
      data: openid,
      success: () => {
        wx.showToast({ title: '已复制', icon: 'none' })
      }
    })
  },

  // 修改用户角色
  onRoleChange(e) {
    const openid = e.currentTarget.dataset.openid
    const index = e.detail.value
    const newRole = this.data.roleOptions[index].value
    
    const user = this.data.userList.find(u => u.openid === openid)
    if (!user) return
    
    if (user.role === newRole) return
    
    wx.showModal({
      title: '确认修改',
      content: `确定将 "${user.nickName || '微信用户'}" 设为 ${this.getRoleLabel(newRole)}？`,
      success: (res) => {
        if (res.confirm) {
          this.updateUserRole(openid, newRole)
        }
      }
    })
  },

  // 更新用户角色
  updateUserRole(openid, newRole) {
    wx.showLoading({ title: '处理中...', mask: true })
    
    wx.cloud.callFunction({
      name: 'userManage',
      data: { action: 'setRole', targetOpenid: openid, role: newRole },
      success: (res) => {
        wx.hideLoading()
        if (res.result && res.result.success) {
          wx.showToast({ title: res.result.message || '修改成功', icon: 'success' })
          // 刷新列表
          this.loadUserList()
        } else {
          wx.showToast({ title: res.result?.error || '修改失败', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '网络异常', icon: 'none' })
      }
    })
  },

  // 删除用户按钮点击
  onDeleteUser(e) {
    const openid = e.currentTarget.dataset.openid
    const nickName = e.currentTarget.dataset.nickname || '该用户'
    
    this.setData({
      showDeleteModal: true,
      deleteTarget: { openid, nickName }
    })
  },

  // 关闭删除弹窗
  closeDeleteModal() {
    this.setData({
      showDeleteModal: false,
      deleteTarget: { openid: '', nickName: '' }
    })
  },

  // 确认删除用户
  confirmDelete() {
    const { openid } = this.data.deleteTarget
    if (!openid) return

    wx.showLoading({ title: '删除中...', mask: true })

    wx.cloud.callFunction({
      name: 'userManage',
      data: { action: 'deleteUser', targetOpenid: openid },
      success: (res) => {
        wx.hideLoading()
        if (res.result && res.result.success) {
          wx.showToast({ title: '删除成功', icon: 'success' })
          this.closeDeleteModal()
          // 刷新列表
          this.loadUserList()
        } else {
          wx.showToast({ title: res.result?.error || '删除失败', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '网络异常', icon: 'none' })
      }
    })
  },

  // 阻止事件冒泡
  stopTap() {}
})
