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
    // 清除旧缓存，强制加载最新数据
    wx.removeStorageSync('cachedUserList')
    wx.removeStorageSync('cachedUserStats')
    this.checkAdminAndLoad()
  },

  // 加载缓存数据（秒开）
  loadCachedData() {
    const cached = wx.getStorageSync('cachedUserList')
    const cachedStats = wx.getStorageSync('cachedUserStats')
    if (cached && cachedStats) {
      this.setData({
        userList: cached,
        userTotal: cachedStats.userTotal || 0,
        adminStatAdmin: cachedStats.adminStatAdmin || 0,
        adminStatVip: cachedStats.adminStatVip || 0,
        adminStatUser: cachedStats.adminStatUser || 0,
        adminStatBlocked: cachedStats.adminStatBlocked || 0
      })
    }
  },

  // 保存到缓存
  saveToCache(userList, stats) {
    wx.setStorageSync('cachedUserList', userList)
    wx.setStorageSync('cachedUserStats', stats)
  },

  onShow() {
    // 每次显示时检查登录状态并刷新
    if (this.data.userList.length === 0) {
      this.checkAdminAndLoad()
    }
  },

  // 手动刷新数据
  onRefresh() {
    this.checkAdminAndLoad()
  },

  // 检查管理员权限并加载数据
  checkAdminAndLoad() {
    this.setData({ loading: true })
    
    // 优化：并行调用权限检查和用户列表
    Promise.all([
      wx.cloud.callFunction({ name: 'userManage', data: { action: 'checkPermission', requiredLevel: 3 } }),
      wx.cloud.callFunction({ name: 'userManage', data: { action: 'listUsers', page: 1, pageSize: 50 } })
    ]).then(([permRes, listRes]) => {
      if (permRes.result && permRes.result.hasPermission) {
        this.processUserList(listRes)
      } else {
        this.setData({ loading: false })
        wx.showToast({ title: '权限不足', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 1500)
      }
    }).catch((err) => {
      console.error('云函数调用失败:', err)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    })
  },

  // 处理用户列表数据
  processUserList(res) {
    if (res.result && res.result.success) {
      const usersData = res.result.users || []
      const currentOpenid = this.data.currentOpenid
      
      // 预处理用户数据
      const users = usersData.map(user => {
        const createdAt = user.createdAt || ''
        return {
          openid: user.openid,
          openidDisplay: user.openid || '---',
          nickName: user.nickName || '微信用户',
          avatarUrl: user.avatarUrl || '',
          role: user.role || 'user',
          roleLabel: this.getRoleLabel(user.role || 'user'),
          createdAt: createdAt,
          joinDate: createdAt ? createdAt.substring(0, 10) : '未知',
          isCurrentUser: user.openid === currentOpenid
        }
      })
      
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
      
      // 保存到缓存
      this.saveToCache(users, {
        userTotal: res.result.total || users.length,
        adminStatAdmin: statAdmin,
        adminStatVip: statVip,
        adminStatUser: statUser,
        adminStatBlocked: statBlocked
      })
    } else {
      this.setData({ loading: false })
      wx.showToast({ title: res.result?.error || '加载失败', icon: 'none' })
    }
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

  // 下拉刷新
  onPullDownRefresh() {
    this.checkAdminAndLoad()
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
          // 记录操作日志
          this.addAdminLog('修改角色', `将用户 ${openid.slice(-8)} 设为 ${this.getRoleLabel(newRole)}`)
          // 刷新列表
          this.checkAdminAndLoad()
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

  // 添加管理操作日志
  addAdminLog(title, desc) {
    const logs = wx.getStorageSync('adminLogs') || []
    const now = new Date()
    const time = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    logs.unshift({ type: 'admin', title, desc, time })
    // 最多保留 100 条
    if (logs.length > 100) logs.length = 100
    wx.setStorageSync('adminLogs', logs)
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
    const { openid, nickName } = this.data.deleteTarget
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
          // 记录操作日志
          this.addAdminLog('删除用户', `删除用户「${nickName || '未知'}」(${openid.slice(-8)})`)
          // 刷新列表
          this.checkAdminAndLoad()
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
