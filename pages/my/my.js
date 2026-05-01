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
    hasShownProfilePrompt: false,  // 是否已显示过资料设置提示（防止重复弹窗）
    // 登录状态
    isLoggedIn: false,
    userInfo: null,
    roleLabel: '未识别',
    openid: '',
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
    // 从 storage 同步 openid
    const savedOpenid = wx.getStorageSync('userOpenid')
    if (savedOpenid) {
      this.setData({
        openid: savedOpenid,
        openidShort: savedOpenid.slice(-8).toUpperCase()
      })
    }
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
            
            // 简化：直接使用云端数据更新
            const avatarUrl = await this.getAvatarUrl(user.avatarUrl)
            const nickName = user.nickName || this.data.nickName || '微信用户'
            const isAdminUser = user.role === 'admin' || user.level >= 3
            
            // 更新时间
            const now = new Date()
            const activeTime = this.formatDateTime(now)
            
            this.setData({
              avatarUrl: avatarUrl,
              nickName: nickName,
              roleLabel: user.roleLabel,
              openid: user.openid || '',
              openidShort: user.openid ? user.openid.slice(-8).toUpperCase() : '',
              isAdmin: isAdminUser,
              lastActiveTime: activeTime,
              userInfo: user
            })
            
            // 同步到本地存储
            wx.setStorageSync('userAvatar', avatarUrl)
            if (nickName) {
              wx.setStorageSync('userNickName', nickName)
            }
            wx.setStorageSync('lastActiveTime', activeTime)
            
            // 同步到全局
            app.globalData.userInfo = user
            
            // 刷新统计
            this.loadData()
            this.calculateCacheSize()
          }
        },
        fail: (err) => {
          console.error('刷新用户信息失败', err)
          wx.showToast({ title: '刷新失败', icon: 'none' })
        },
        complete: () => {
          wx.stopPullDownRefresh()
          wx.showToast({
            title: '刷新完成',
            icon: 'none',
            duration: 800
          })
        }
      })
    } else {
      wx.stopPullDownRefresh()
    }
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
      // 检查是否需要弹出资料设置框
      this.checkProfileSetup()
    }
  },

  // 检查是否需要设置资料（首次登录或未设置头像昵称）
  checkProfileSetup() {
    // 防止重复弹窗
    if (this.data.hasShownProfilePrompt) return
    
    const avatarUrl = wx.getStorageSync('userAvatar') || ''
    const nickName = wx.getStorageSync('userNickName') || ''
    
    // 如果本地没有头像或昵称，从云端获取后判断
    if (!avatarUrl || !nickName) {
      // 调用云函数获取用户信息
      wx.cloud.callFunction({
        name: 'userManage',
        data: { action: 'getInfo' },
        success: (res) => {
          if (res.result && res.result.success) {
            const user = res.result.user
            const hasCloudProfile = user.avatarUrl || user.nickName
            
            if (!hasCloudProfile) {
              // 云端也没有资料，弹出设置框
              this.setData({
                showProfileModal: true,
                hasShownProfilePrompt: true,
                editAvatarUrl: '/images/icon_user_white.png',
                editNickName: '',
                isFirstLogin: true
              })
              wx.setStorageSync('hasShownProfilePrompt', true)
            } else {
              // 云端有资料，更新本地缓存
              if (user.nickName) {
                wx.setStorageSync('userNickName', user.nickName)
              }
              // 获取云端头像
              this.getAvatarUrl(user.avatarUrl).then(url => {
                wx.setStorageSync('userAvatar', url)
              })
              this.setData({ hasShownProfilePrompt: true })
              wx.setStorageSync('hasShownProfilePrompt', true)
            }
          }
        },
        fail: () => {
          console.error('检查资料设置状态失败')
        }
      })
    } else {
      // 本地有资料，确保标记已设置
      this.setData({ hasShownProfilePrompt: true })
      wx.setStorageSync('hasShownProfilePrompt', true)
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
              openid: user.openid || '',
              openidShort: user.openid ? user.openid.slice(-8).toUpperCase() : '',
              isAdmin: false,
              loginTime: loginTime,
              lastActiveTime: loginTime,
              hasShownProfilePrompt: true
            })
            wx.setStorageSync('isLoggedIn', true)
            wx.setStorageSync('userOpenid', user.openid)
            wx.setStorageSync('hasShownProfilePrompt', true)
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

          const isAdminUser = user.role === 'admin' || user.level >= 3
          this.setData({
            isLoggedIn: true,
            userInfo: user,
            roleLabel: user.roleLabel,
            openid: user.openid || '',
            openidShort: user.openid ? user.openid.slice(-8).toUpperCase() : '',
            isAdmin: isAdminUser,
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
              this.setData({ avatarUrl, nickName, hasShownProfilePrompt: true })
              wx.setStorageSync('userAvatar', avatarUrl)
              wx.setStorageSync('userNickName', nickName)
              wx.setStorageSync('hasShownProfilePrompt', true)
              wx.showToast({ title: '登录成功', icon: 'success' })
            })
          } else {
            // 云端无资料，弹出编辑框让用户设置头像昵称
            wx.showToast({ title: '请设置头像昵称', icon: 'none' })
            setTimeout(() => {
              this.setData({
                showProfileModal: true,
                hasShownProfilePrompt: true,
                editAvatarUrl: '/images/icon_user_white.png',
                editNickName: '',
                isFirstLogin: true
              })
              wx.setStorageSync('hasShownProfilePrompt', true)
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
          
          const isAdminUser = user.role === 'admin' || user.level >= 3
          this.setData({
            userInfo: user,
            roleLabel: user.roleLabel,
            openidShort,
            isAdmin: isAdminUser,
            lastActiveTime: activeTime,
            avatarVersion: user.avatarVersion || 1
          })
          wx.setStorageSync('lastActiveTime', activeTime)
          // 同步到全局
          app.globalData.userInfo = user
          
          // 检查资料设置标记
          const hasShown = wx.getStorageSync('hasShownProfilePrompt')
          if (hasShown) {
            this.setData({ hasShownProfilePrompt: true })
          }
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
    this.setData({ 
      showProfileModal: false, 
      isFirstLogin: false,
      hasShownProfilePrompt: true  // 关闭弹窗后标记已显示过，防止下次重复弹出
    })
    wx.setStorageSync('hasShownProfilePrompt', true)
  },

  // 跳过/取消（保持登录状态但不设置资料）
  cancelLogin() {
    this.setData({ 
      showProfileModal: false, 
      isFirstLogin: false,
      hasShownProfilePrompt: true
    })
    wx.setStorageSync('hasShownProfilePrompt', true)
    wx.showToast({ title: '可稍后设置', icon: 'none', duration: 1500 })
  },

  // 取消登录（退出登录状态）
  cancelLoginAndLogout() {
    wx.showModal({
      title: '提示',
      content: '确定要取消登录吗？',
      confirmText: '确定',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          // 清除所有登录相关数据
          wx.clearStorageSync()
          // 重置页面状态为未登录
          this.setData({
            isLoggedIn: false,
            showProfileModal: false,
            isFirstLogin: false,
            hasShownProfilePrompt: false,
            userInfo: null,
            nickName: '',
            avatarUrl: '',
            roleLabel: '',
            openid: '',
    openidShort: '',
            isAdmin: false,
            loginTime: '',
            lastActiveTime: '',
            // 菜单数据重置
            todayCount: 0,
            totalCount: 0,
            historyCount: 0,
            adminCount: 0
          })
          // 重置全局数据
          app.globalData.userInfo = null
          wx.showToast({ title: '已取消登录', icon: 'none', duration: 1500 })
        }
      }
    })
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
            openid: '',
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
      content: '功能：快速扫描条码、二维码，智能解码，历史记录管理\n开发者：条码扫描器团队',
      showCancel: false,
      confirmText: '知道了'
    })
  }
})
