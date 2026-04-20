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
    isFirstLogin: false,  // 是否首次登录
    // 登录状态
    isLoggedIn: false,
    userInfo: null,
    roleLabel: '未识别',
    openidShort: '',
    isAdmin: false,
    loginTime: '',      // 登录时间
    lastActiveTime: '',  // 最后活跃时间
    appVersion: '4.0.0' // 小程序版本号
  },

  onLoad() {
    this.getAppVersion()
    this.checkLoginStatus()
  },
  
  // 获取小程序版本号
  getAppVersion() {
    try {
      const info = wx.getAccountInfoSync()
      console.log('【版本号】账户信息:', info)
      // 优先使用version
      let version = info.miniProgram?.version || '4.0.0'
      console.log('【版本号】获取结果:', version)
      this.setData({ appVersion: version })
    } catch (e) {
      console.log('【版本号】获取失败，使用默认值4.0.0', e)
      this.setData({ appVersion: '4.0.0' })
    }
  },

  onShow() {
    this.loadData()
    this.calculateCacheSize()
    // onShow 时不调用云函数，只使用本地缓存数据
    // 云函数只在登录时或下拉刷新时调用
  },

  // 下拉刷新
  onPullDownRefresh() {
    console.log('触发下拉刷新')
    
    // 重新加载用户身份（头像、昵称等）
    if (this.data.isLoggedIn) {
      wx.cloud.callFunction({
        name: 'userManage',
        data: { action: 'getInfo' },
        success: async (res) => {
          if (res.result && res.result.success) {
            const user = res.result.user
            const avatarUrl = await this.getAvatarUrl(user.avatarUrl)
            this.setData({
              avatarUrl: avatarUrl,
              nickName: user.nickName || this.data.nickName,
              roleLabel: user.roleLabel,
              userInfo: user
            })
            wx.setStorageSync('userAvatar', avatarUrl)
            if (user.nickName) {
              wx.setStorageSync('userNickName', user.nickName)
            }
          }
        },
        fail: (err) => {
          console.error('刷新用户信息失败', err)
        }
      })
    }
    
    wx.stopPullDownRefresh()
    wx.showToast({
      title: '刷新完成',
      icon: 'none',
      duration: 1000
    })
  },

  // ===== 登录流程 =====
  checkLoginStatus() {
    const loggedIn = wx.getStorageSync('isLoggedIn')
    const savedLoginTime = wx.getStorageSync('loginTime')
    const savedLastActive = wx.getStorageSync('lastActiveTime')
    if (loggedIn) {
      this.setData({ 
        isLoggedIn: true,
        loginTime: savedLoginTime || '',
        lastActiveTime: savedLastActive || savedLoginTime || ''
      })
      this.loadUserProfile()
      this.loadUserIdentity()
    }
  },

  // 一键登录：直接调用云函数获取身份
  showLogin() {
    wx.showLoading({ title: '登录中...', mask: true })
    wx.cloud.callFunction({
      name: 'userManage',
      data: { action: 'getInfo' },
      success: (res) => {
        wx.hideLoading()
        if (res.result.success) {
          const user = res.result.user
          const now = new Date()
          const loginTime = this.formatDateTime(now)

          // 检查是否被封禁
          if (user.isBlocked) {
            this.setData({
              isLoggedIn: true,
              userInfo: user,
              roleLabel: user.roleLabel,
              openidShort: user.openid ? user.openid.slice(-8).toUpperCase() : '',
              isAdmin: false,
              loginTime: loginTime,
              lastActiveTime: loginTime
            })
            wx.setStorageSync('isLoggedIn', true)
            wx.setStorageSync('userOpenid', user.openid)
            // 同步到全局
            app.globalData.userInfo = user
            wx.showModal({
              title: '账号提示',
              content: '您的账号已被封禁，仅能登录，无法使用其他功能',
              showCancel: false,
              confirmText: '知道了'
            })
            return
          }

          this.setData({
            isLoggedIn: true,
            userInfo: user,
            roleLabel: user.roleLabel,
            openidShort: user.openid ? user.openid.slice(-8).toUpperCase() : '',
            isAdmin: user.role === 'admin',
            loginTime: loginTime,
            lastActiveTime: loginTime,
            avatarVersion: user.avatarVersion || 1
          })

          wx.setStorageSync('isLoggedIn', true)
          wx.setStorageSync('loginTime', loginTime)
          wx.setStorageSync('lastActiveTime', loginTime)
          if (user.openid) {
            wx.setStorageSync('userOpenid', user.openid)
          }
          // 同步到全局，确保其他页面能获取最新状态
          app.globalData.userInfo = user

          // 检查云端是否有头像昵称
          const hasProfile = user.avatarUrl || user.nickName
          if (hasProfile) {
            // 云端有资料，转换头像URL为HTTPS后使用
            this.getAvatarUrl(user.avatarUrl).then(avatarUrl => {
              const nickName = user.nickName || '微信用户'
              this.setData({ avatarUrl, nickName })
              wx.setStorageSync('userAvatar', avatarUrl)
              wx.setStorageSync('userNickName', nickName)
              wx.showToast({ title: '登录成功', icon: 'success' })
            })
          } else {
            // 云端无资料，弹出编辑框让用户设置微信头像昵称
            wx.showToast({ title: '请设置头像昵称', icon: 'none' })
            setTimeout(() => {
              this.setData({
                showProfileModal: true,
                editAvatarUrl: '/images/icon_user_white.png',
                editNickName: '',
                isFirstLogin: true
              })
            }, 500)
          }
        } else {
          wx.showToast({ title: res.result.error || '登录失败', icon: 'none' })
        }
      },
      fail: (err) => {
        wx.hideLoading()
        console.error('登录失败', err)
        wx.showToast({ title: '网络异常，请重试', icon: 'none' })
      }
    })
  },

  // ===== 用户身份 =====
  loadUserIdentity() {
    const openid = wx.getStorageSync('userOpenid') || ''
    
    wx.cloud.callFunction({
      name: 'userManage',
      data: { action: 'getInfo' },
      success: async (res) => {
        if (res.result.success) {
          const user = res.result.user
          const openidShort = user.openid ? user.openid.slice(-8).toUpperCase() : ''
          const now = new Date()
          const activeTime = this.formatDateTime(now)
          
          // 如果云端有昵称，同步到本地
          if (user.nickName) {
            this.setData({ nickName: user.nickName })
            wx.setStorageSync('userNickName', user.nickName)
          }
          
          // 获取头像
          const avatarUrl = await this.getAvatarUrl(user.avatarUrl)
          this.setData({ avatarUrl: avatarUrl })
          wx.setStorageSync('userAvatar', avatarUrl)
          
          this.setData({
            userInfo: user,
            roleLabel: user.roleLabel,
            openidShort,
            isAdmin: user.role === 'admin',
            lastActiveTime: activeTime,
            avatarVersion: user.avatarVersion || 1
          })
          wx.setStorageSync('lastActiveTime', activeTime)
          // 同步到全局
          app.globalData.userInfo = user
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
    // 封禁用户不能编辑资料
    if (this.data.userInfo?.isBlocked) {
      wx.showModal({
        title: '无法操作',
        content: '您的账号已被封禁，无法编辑资料',
        showCancel: false
      })
      return
    }
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
    const tempAvatarUrl = this.data.editAvatarUrl
    const nickName = this.data.editNickName || this.data.nickName || '微信用户'
    
    // 如果选择了新头像（临时路径），需要上传到云存储
    if (tempAvatarUrl && tempAvatarUrl.startsWith('http://tmp') || tempAvatarUrl && tempAvatarUrl.startsWith('wxfile://')) {
      wx.showLoading({ title: '上传中...', mask: true })
      
      // 获取当前用户openid作为文件名（统一使用jpg扩展名）
      const openid = wx.getStorageSync('userOpenid') || ''
      const cloudPath = `avatars/${openid}.jpg`
      
      // 先删除旧头像，再上传新头像
      this.deleteOldAvatar().finally(() => {
        // 直接上传新头像（云存储会自动覆盖同名文件）
        wx.cloud.uploadFile({
          cloudPath: cloudPath,
          filePath: tempAvatarUrl,
          success: async (res) => {
            console.log('上传成功，fileID:', res.fileID)
            // 直接使用返回的cloud://路径，让getAvatarUrl处理转换
            this.saveProfileToLocalAndCloud(res.fileID, nickName)
            wx.hideLoading()
          },
          fail: (err) => {
            wx.hideLoading()
            console.error('上传头像失败', err)
            wx.showToast({ title: '上传失败', icon: 'none' })
          }
        })
      })
    } else {
      // 没有新头像，直接使用原路径
      this.saveProfileToLocalAndCloud(tempAvatarUrl || '/images/icon_user_white.png', nickName)
    }
  },

  // 删除旧头像（根据openid删除）
  deleteOldAvatar() {
    return new Promise((resolve) => {
      const openid = wx.getStorageSync('userOpenid') || ''
      if (!openid) {
        resolve()
        return
      }
      
      // 根据openid构建云存储路径并删除
      const cloudPath = this.getAvatarCloudPath(openid)
      
      wx.cloud.deleteFile({
        fileList: [cloudPath],
        success: (res) => {
          console.log('旧头像已删除:', res)
          // 清除缓存
          const cached = this.data._avatarCache || {}
          delete cached[cloudPath]
          this.setData({ _avatarCache: cached })
          resolve()
        },
        fail: (err) => {
          console.error('删除旧头像失败:', err)
          resolve() // 即使删除失败也继续
        }
      })
    })
  },

  saveProfileToLocalAndCloud(avatarUrl, nickName) {
    this.setData({
      avatarUrl,
      nickName,
      showProfileModal: false
    })
    wx.setStorageSync('userAvatar', avatarUrl)
    wx.setStorageSync('userNickName', nickName)
    this.syncProfileToCloud(avatarUrl, nickName)
    wx.showToast({ title: '设置成功', icon: 'success' })
  },

  closeProfileModal() {
    this.setData({ showProfileModal: false, isFirstLogin: false })
  },

  // 阻止事件冒泡
  stopTap() {
    // 空方法，仅用于阻止事件冒泡
  },

  // 同步资料到云端（通过云函数，避免数据库权限问题）
  syncProfileToCloud(avatarUrl, nickName) {
    if (!this.data.isLoggedIn) return
    wx.cloud.callFunction({
      name: 'userManage',
      data: {
        action: 'updateProfile',
        nickName: nickName || this.data.nickName || '',
        avatarUrl: avatarUrl || this.data.avatarUrl || ''
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
            loginTime: '',
            lastActiveTime: ''
          })
          wx.removeStorageSync('isLoggedIn')
          wx.removeStorageSync('userAvatar')
          wx.removeStorageSync('userNickName')
          wx.removeStorageSync('loginTime')
          wx.removeStorageSync('lastActiveTime')
          wx.showToast({ title: '已退出', icon: 'success' })
        }
      }
    })
  },

  // 跳转到用户管理页面
  goToUserManage() {
    wx.navigateTo({ url: '/pages/userManage/userManage' })
  },

  // ===== 通用功能 =====

  // 根据openid获取云存储头像URL
  getAvatarCloudPath(openid) {
    return `cloud://avatars/${openid}.jpg`
  },

  // 获取头像URL（简化版）- 强制刷新避免缓存
  async getAvatarUrl(avatarUrl) {
    console.log('getAvatarUrl called with:', avatarUrl)
    if (!avatarUrl) return '/images/icon_user_white.png'
    
    // 已经是https链接，直接返回
    if (avatarUrl.startsWith('https://')) {
      console.log('Returning https URL:', avatarUrl)
      return avatarUrl
    }
    
    // 微信头像链接
    if (avatarUrl.startsWith('http://thirdwx.qlogo.cn') || avatarUrl.startsWith('http://wx.qlogo.cn')) {
      const url = avatarUrl.replace('http://', 'https://')
      console.log('Converted wechat avatar:', url)
      return url
    }
    
    // 云存储cloud://链接 - 强制刷新获取最新URL
    if (avatarUrl.startsWith('cloud://')) {
      console.log('Getting temp URL for cloud file:', avatarUrl)
      try {
        // 添加时间戳参数强制刷新，避免缓存返回旧文件
        const timestamp = Date.now()
        const res = await wx.cloud.getTempFileURL({ 
          fileList: [{
            fileID: avatarUrl,
            maxAge: 0  // 不使用缓存
          }]
        })
        console.log('getTempFileURL result:', res)
        if (res.fileList && res.fileList[0]) {
          const fileInfo = res.fileList[0]
          console.log('fileInfo:', fileInfo)
          if (fileInfo.status === 0 && fileInfo.tempFileURL) {
            // 添加时间戳防止CDN缓存
            const finalUrl = fileInfo.tempFileURL + '?t=' + timestamp
            console.log('Returning temp URL with cache bust:', finalUrl)
            return finalUrl
          }
          console.log('File status not 0 or no tempURL, status:', fileInfo.status)
        }
      } catch (e) {
        console.error('获取云存储头像失败', e)
      }
      return '/images/icon_user_white.png'
    }
    
    // 本地默认头像
    console.log('Unknown avatar type, returning default')
    return avatarUrl || '/images/icon_user_white.png'
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

  formatDateTime(date) {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    const h = String(date.getHours()).padStart(2, '0')
    const min = String(date.getMinutes()).padStart(2, '0')
    return `${y}-${m}-${d} ${h}:${min}`
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
      content: '版本：4.0.0\n功能：快速扫描条码、二维码，智能解码，历史记录管理\n开发者：条码扫描器团队',
      showCancel: false,
      confirmText: '知道了'
    })
  }
})
