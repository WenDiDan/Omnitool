const app = getApp()
const barcode = require('../../utils/barcode.js')

Page({
  data: {
    avatarUrl: '',
    nickName: '',
    totalCount: 0,
    todayCount: 0,
    typeCount: 0,
    cacheSize: '0KB',
    // 编辑弹窗
    showProfileModal: false,
    editAvatarUrl: '',
    editNickName: '',
    // 登录状态
    isLoggedIn: false,
    userInfo: null,
    roleLabel: '未识别',
    openidShort: '',
    isAdmin: false,
    // 管理员功能
    showAdminPanel: false,
    userList: [],
    userTotal: 0,
    userPage: 1,
    adminLoading: false,
    adminStatAdmin: 0,
    adminStatVip: 0,
    adminStatUser: 0,
    adminStatBlocked: 0
  },

  onLoad() {
    this.checkLoginStatus()
  },

  onShow() {
    this.loadData()
    this.calculateCacheSize()
    if (this.data.isLoggedIn) {
      this.loadUserIdentity()
    }
  },

  // ===== 登录流程 =====
  checkLoginStatus() {
    const loggedIn = wx.getStorageSync('isLoggedIn')
    if (loggedIn) {
      this.setData({ isLoggedIn: true })
      this.loadUserProfile()
      this.loadUserIdentity()
    }
  },

  // 一键登录：直接调用云函数获取身份
  showLogin() {
    wx.showLoading({ title: '登录中', mask: true })
    wx.cloud.callFunction({
      name: 'userManage',
      data: { action: 'getInfo' },
      success: (res) => {
        wx.hideLoading()
        if (res.result.success) {
          const user = res.result.user
          const avatarUrl = user.avatarUrl || '/images/icon_user_white.png'
          const nickName = user.nickName || '微信用户'

          this.setData({
            isLoggedIn: true,
            avatarUrl,
            nickName,
            userInfo: user,
            roleLabel: user.roleLabel,
            openidShort: user.openid ? user.openid.slice(-8).toUpperCase() : '',
            isAdmin: user.role === 'admin'
          })

          wx.setStorageSync('isLoggedIn', true)
          wx.setStorageSync('userAvatar', avatarUrl)
          wx.setStorageSync('userNickName', nickName)

          wx.showToast({ title: '登录成功', icon: 'success' })
        } else {
          wx.showToast({ title: res.result.error || '登录失败', icon: 'none' })
        }
      },
      fail: (err) => {
        wx.hideLoading()
        console.error('登录失败', err)
        wx.showToast({ title: '登录失败，请重试', icon: 'none' })
      }
    })
  },

  // ===== 用户身份 =====
  loadUserIdentity() {
    wx.cloud.callFunction({
      name: 'userManage',
      data: { action: 'getInfo' },
      success: (res) => {
        if (res.result.success) {
          const user = res.result.user
          const openidShort = user.openid ? user.openid.slice(-8).toUpperCase() : ''
          // 如果云端有昵称/头像，同步到本地
          if (user.nickName) {
            this.setData({ nickName: user.nickName })
            wx.setStorageSync('userNickName', user.nickName)
          }
          if (user.avatarUrl) {
            this.setData({ avatarUrl: user.avatarUrl })
            wx.setStorageSync('userAvatar', user.avatarUrl)
          }
          this.setData({
            userInfo: user,
            roleLabel: user.roleLabel,
            openidShort,
            isAdmin: user.role === 'admin'
          })
        }
      },
      fail: (err) => {
        console.error('获取用户身份失败', err)
      }
    })
  },

  loadUserProfile() {
    const avatarUrl = wx.getStorageSync('userAvatar') || ''
    const nickName = wx.getStorageSync('userNickName') || ''
    this.setData({ avatarUrl, nickName })
  },

  onEditProfile() {
    if (!this.data.isLoggedIn) return
    this.setData({
      showProfileModal: true,
      editAvatarUrl: this.data.avatarUrl,
      editNickName: this.data.nickName
    })
  },

  onEditChooseAvatar(e) {
    const tempUrl = e.detail.avatarUrl
    if (!tempUrl) return
    this.setData({ editAvatarUrl: tempUrl })
  },

  onEditNickInput(e) {
    this.setData({ editNickName: e.detail.value })
  },

  confirmProfile() {
    const avatarUrl = this.data.editAvatarUrl || this.data.avatarUrl
    const nickName = this.data.editNickName ?? this.data.nickName
    this.setData({
      avatarUrl,
      nickName,
      showProfileModal: false
    })
    wx.setStorageSync('userAvatar', avatarUrl)
    wx.setStorageSync('userNickName', nickName || '')
    this.syncProfileToCloud()
  },

  closeProfileModal() {
    this.setData({ showProfileModal: false })
  },

  // 同步资料到云端（通过云函数，避免数据库权限问题）
  syncProfileToCloud() {
    if (!this.data.isLoggedIn) return
    wx.cloud.callFunction({
      name: 'userManage',
      data: {
        action: 'updateProfile',
        nickName: this.data.nickName || '',
        avatarUrl: this.data.avatarUrl || ''
      }
    })
  },

  // 退出登录
  logout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出当前账号吗？',
      success: (res) => {
        if (res.confirm) {
          this.setData({
            isLoggedIn: false,
            userInfo: null,
            avatarUrl: '',
            nickName: '',
            roleLabel: '未登录',
            openidShort: '',
            isAdmin: false,
            showAdminPanel: false
          })
          wx.removeStorageSync('isLoggedIn')
          wx.removeStorageSync('userAvatar')
          wx.removeStorageSync('userNickName')
          wx.showToast({ title: '已退出', icon: 'success' })
        }
      }
    })
  },

  // ===== 管理员功能 =====
  toggleAdminPanel() {
    if (!this.data.isAdmin) return
    const show = !this.data.showAdminPanel
    this.setData({ showAdminPanel: show })
    if (show) this.loadUserList()
  },

  loadUserList() {
    this.setData({ adminLoading: true })
    wx.cloud.callFunction({
      name: 'userManage',
      data: { action: 'listUsers', page: this.data.userPage, pageSize: 20 },
      success: (res) => {
        if (res.result.success) {
          const users = res.result.users
          const statAdmin = users.filter(u => u.role === 'admin').length
          const statVip = users.filter(u => u.role === 'vip').length
          const statUser = users.filter(u => u.role === 'user').length
          const statBlocked = users.filter(u => u.role === 'blocked').length
          this.setData({
            userList: users,
            userTotal: res.result.total,
            adminStatAdmin: statAdmin,
            adminStatVip: statVip,
            adminStatUser: statUser,
            adminStatBlocked: statBlocked,
            adminLoading: false
          })
        } else {
          this.setData({ adminLoading: false })
        }
      },
      fail: () => {
        this.setData({ adminLoading: false })
      }
    })
  },

  onSetRole(e) {
    const { openid, role } = e.currentTarget.dataset
    if (role === 'admin') return // 不能操作管理员角色，防止误操作
    const roles = ['admin', 'vip', 'user', 'blocked']
    const currentIdx = roles.indexOf(role)
    wx.showActionSheet({
      itemList: ['设为管理员', '设为VIP用户', '设为普通用户', '封禁用户'],
      itemColor: currentIdx === 3 ? '#C0392B' : undefined,
      success: (res) => {
        const newRole = roles[res.tapIndex]
        if (newRole === role) return
        wx.cloud.callFunction({
          name: 'userManage',
          data: { action: 'setRole', targetOpenid: openid, role: newRole },
          success: (result) => {
            if (result.result.success) {
              wx.showToast({ title: '设置成功', icon: 'success' })
              this.loadUserList()
            } else {
              wx.showToast({ title: result.result.error, icon: 'none' })
            }
          }
        })
      }
    })
  },

  refreshAdmin() {
    this.loadUserList()
  },

  // ===== 通用功能 =====
  loadData() {
    const history = app.globalData.scanHistory || []
    const today = this.formatDate(new Date())
    const todayCount = history.filter(item => item.time && item.time.indexOf(today) === 0).length
    const types = new Set(history.map(item => barcode.identifyBarcodeType(item.code)))
    this.setData({ totalCount: history.length, todayCount, typeCount: types.size })
  },

  formatDate(date) {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return y + '-' + m + '-' + d
  },

  calculateCacheSize() {
    try {
      const info = wx.getStorageInfoSync()
      this.setData({ cacheSize: (info.currentSize / 1024).toFixed(2) + 'KB' })
    } catch (e) {}
  },

  goToHistory() {
    wx.navigateTo({ url: '/pages/history/history' })
  },

  goToSettings() {
    wx.navigateTo({ url: '/package1/pages/settings/settings' })
  },

  clearCache() {
    wx.showModal({
      title: '确认清除',
      content: '清除缓存不会影响扫描历史记录和设置，确定要清除吗？',
      success: (res) => {
        if (res.confirm) {
          const keep = ['scanHistory', 'settings', 'hideRecentScans', 'userAvatar', 'userNickName', 'isLoggedIn']
          const backup = {}
          keep.forEach(k => { const v = wx.getStorageSync(k); if (v) backup[k] = v })
          wx.clearStorageSync()
          Object.entries(backup).forEach(([k, v]) => wx.setStorageSync(k, v))
          this.calculateCacheSize()
          wx.showToast({ title: '缓存已清除', icon: 'success' })
        }
      }
    })
  },

  showAbout() {
    wx.showModal({
      title: '关于条码扫描器',
      content: '版本：1.0.0\n功能：快速扫描条码、二维码，智能解码，历史记录管理\n开发者：条码扫描器团队',
      showCancel: false,
      confirmText: '知道了'
    })
  }
})
