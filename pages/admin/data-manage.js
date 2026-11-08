const app = getApp()

Page({
  data: {
    users: [],
    searchKey: '',
    showEditModal: false,
    editUser: null,
    editDays: 3,
    editVipRemainDays: 0
  },

  onLoad() {
    this.checkAdmin()
  },

  async checkAdmin() {
    const userInfo = app.globalData.userInfo
    if (!userInfo || !userInfo.openid) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1000)
      return
    }
    try {
      const res = await wx.cloud.callFunction({
        name: 'userManage',
        data: { action: 'checkPermission', targetOpenid: userInfo.openid }
      })
      if (res.result && res.result.hasPermission) {
        this.loadUsers()
      } else {
        wx.showToast({ title: '无管理权限', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 1000)
      }
    } catch (e) {
      wx.showToast({ title: '权限校验失败', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1000)
    }
  },

  async loadUsers() {
    wx.showLoading({ title: '加载中...' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'userManage',
        data: { action: 'listUsers', page: 1, pageSize: 50 }
      })
      wx.hideLoading()
      if (res.result.success) {
        // 获取每个用户的 retention days
        const users = res.result.users || []
        this.setData({ users })
        // 异步获取 retention days
        this.loadRetentionDays(users)
      } else {
        wx.showToast({ title: res.result.error || '加载失败', icon: 'none' })
      }
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '网络异常', icon: 'none' })
    }
  },

  // 获取用户保留天数
  async loadRetentionDays(users) {
    for (const user of users) {
      try {
        const res = await wx.cloud.callFunction({
          name: 'syncScanHistory',
          data: { action: 'getRetention', targetOpenid: user.openid }
        })
        if (res.result.success) {
          const index = this.data.users.findIndex(u => u.openid === user.openid)
          if (index !== -1) {
            this.setData({ [`users[${index}].retentionDays`]: res.result.days })
          }
        }
      } catch (e) {}
    }
  },

  onSearchInput(e) {
    this.setData({ searchKey: e.detail.value })
  },

  getFilteredUsers() {
    const key = this.data.searchKey.trim().toLowerCase()
    if (!key) return this.data.users
    return this.data.users.filter(u =>
      (u.openid && u.openid.toLowerCase().includes(key)) ||
      (u.nickName && u.nickName.toLowerCase().includes(key))
    )
  },

    showEdit(e) {
      const openid = e.currentTarget.dataset.openid
      const user = this.data.users.find(u => u.openid === openid)
      if (!user) return

      // 计算VIP剩余天数
      let vipRemainDays = 0
      if (user.role === 'vip' && user.vipExpiresAt) {
        const expireDate = new Date(user.vipExpiresAt)
        const now = new Date()
        if (expireDate > now) {
          vipRemainDays = Math.ceil((expireDate - now) / (24 * 60 * 60 * 1000))
        }
      }

    this.setData({
      showEditModal: true,
      editUser: user,
      editDays: user.retentionDays || user.historyRetentionDays || 3,
      editVipRemainDays: vipRemainDays
    })
    },

  onEditDaysInput(e) {
    const days = parseInt(e.detail.value) || 1
    this.setData({ editDays: Math.min(days, 36500) })
  },

  async saveRetention() {
    const { editUser, editDays } = this.data
    if (!editUser) return
    wx.showLoading({ title: '保存中...' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'syncScanHistory',
        data: {
          action: 'setRetention',
          targetOpenid: editUser.openid,
          days: this.data.editDays
        }
      })
      wx.hideLoading()
      if (res.result.success) {
        const index = this.data.users.findIndex(u => u.openid === editUser.openid)
        if (index !== -1) {
          this.setData({
            [`users[${index}].retentionDays`]: this.data.editDays,
            showEditModal: false,
            editUser: null
          })
        }
        wx.showToast({ title: '保存成功', icon: 'success' })
      } else {
        wx.showToast({ title: res.result.error || '保存失败', icon: 'none' })
      }
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '网络异常', icon: 'none' })
    }
  },

  closeEditModal() {
    this.setData({ showEditModal: false, editUser: null })
  },

  formatDays(days) {
    if (days >= 36500) return '永久'
    return days + '天'
  },

  stopTap() {}
})
