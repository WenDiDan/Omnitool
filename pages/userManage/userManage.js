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
    ]
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

  // 批量获取头像URL - 强制刷新避免缓存
  async batchGetAvatarUrls(userList) {
    const cloudFiles = []
    const idxMap = {}
    const timestamp = Date.now()
    
    userList.forEach((user, idx) => {
      let url = user.avatarUrl || ''
      
      if (url.startsWith('https://')) {
        user.avatarUrl = url
      } else if (url.startsWith('http://thirdwx.qlogo.cn') || url.startsWith('http://wx.qlogo.cn')) {
        user.avatarUrl = url.replace('http://', 'https://')
      } else if (url.startsWith('cloud://')) {
        cloudFiles.push(url)
        idxMap[url] = idx
      } else {
        user.avatarUrl = '/images/icon_user_white.png'
      }
    })
    
    if (cloudFiles.length > 0) {
      try {
        const fileListWithOptions = cloudFiles.map(fileID => ({
          fileID: fileID,
          maxAge: 0
        }))
        const res = await wx.cloud.getTempFileURL({ fileList: fileListWithOptions })
        if (res.fileList) {
          res.fileList.forEach(fileInfo => {
            const idx = idxMap[fileInfo.fileID]
            if (idx !== undefined && fileInfo.status === 0 && fileInfo.tempFileURL) {
              userList[idx].avatarUrl = fileInfo.tempFileURL + '?t=' + timestamp
            } else if (idx !== undefined) {
              userList[idx].avatarUrl = '/images/icon_user_white.png'
            }
          })
        }
      } catch (e) {
        console.error('批量获取头像失败', e)
      }
    }
    
    return userList
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
  }
})
