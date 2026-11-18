const app = getApp()
const permission = require('../../utils/permission.js')

Page({
  data: {
    avatarUrl: '',
    nickName: '',
    cacheSize: '0KB',
    // 编辑弹窗
    showProfileModal: false,
    editAvatarUrl: '',
    editNickName: '',
    isFirstLogin: false,  // 是否首次登录
    hasShownProfilePrompt: false,  // 是否已显示过资料设置提示（防止重复弹窗）
    // 登录状态
    isLoggedIn: true,
    userInfo: null,
    roleLabel: '未识别',
    openid: '',
    openidShort: '',
    isAdmin: false,
    loginTime: '',      // 登录时间
    lastActiveTime: '',  // 最后活跃时间
    vipLabel: '',       // VIP状态标签
    vipDaysLeft: 0,     // VIP剩余天数
    vipExpiresDate: '', // VIP到期日期（格式：2026-06-29）
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
      let version = info.miniProgram?.version || '1.0.0'
      console.log('【版本号】获取结果:', version)
      this.setData({ appVersion: version })
    } catch (e) {
      console.log('【版本号】获取失败，使用默认值1.0.0', e)
      this.setData({ appVersion: '1.0.0' })
    }
  },

  onShow() {
    this.calculateCacheSize()
    // 从权限缓存模块读取
    this.applyPermissionCache()
    // 等待 autoLogin 完成后再同步（防止并发调用同一云函数导致 WAServiceMainContext 超时）
    this.syncAfterAutoLogin()
  },

  /**
   * 等待 app.js 的 autoLogin 完成后，再检查是否需要同步云端权限
   */
  syncAfterAutoLogin() {
    const app = getApp()
    const loginPromise = app.globalData._autoLoginPromise
    
    if (loginPromise) {
      // autoLogin 仍在进行中，等它完成
      loginPromise.then(() => {
        if (permission.needSync()) {
          permission.syncFromCloud().then(() => {
            this.applyPermissionCache()
          }).catch(() => {})
        }
      }).catch(() => {
        // autoLogin 异常，仍然尝试同步
        if (permission.needSync()) {
          permission.syncFromCloud().then(() => {
            this.applyPermissionCache()
          }).catch(() => {})
        }
      })
    } else {
      // autoLogin 已完成（成功或失败）
      if (permission.needSync()) {
        permission.syncFromCloud().then(() => {
          this.applyPermissionCache()
        }).catch(() => {})
      }
    }
  },

  // 下拉刷新 - 强制从云端同步权限
  onPullDownRefresh() {
    permission.syncFromCloud().then(() => {
      this.applyPermissionCache()
      this.calculateCacheSize()
      wx.stopPullDownRefresh()
      wx.showToast({ title: '刷新完成', icon: 'none', duration: 800 })
    }).catch(() => {
      wx.stopPullDownRefresh()
      wx.showToast({ title: '刷新失败', icon: 'none' })
    })
  },

  // ===== 自动登录流程 =====
  checkLoginStatus() {
    const savedLoginTime = wx.getStorageSync('loginTime')
    const savedLastActive = wx.getStorageSync('lastActiveTime')
    this.setData({ 
      isLoggedIn: true,
      loginTime: savedLoginTime || '',
      lastActiveTime: savedLastActive || savedLoginTime || ''
    })
    this.applyPermissionCache()
    this.checkProfileSetup()
  },

  /**
   * 从权限缓存模块同步数据到页面（同步方法，不阻塞）
   */
  applyPermissionCache() {
    const data = permission.getData()
    if (!data.openid) return

    const avatarUrl = wx.getStorageSync('userAvatar') || ''
    const nickName = wx.getStorageSync('userNickName') || data.nickName || ''
    const vipInfo = permission.getVipInfo()

    // 格式化VIP到期日期
    let vipExpiresDate = ''
    if (vipInfo.expiresAt) {
      try {
        const d = new Date(vipInfo.expiresAt)
        const y = d.getFullYear()
        const m = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        vipExpiresDate = `${y}-${m}-${day}`
      } catch (e) { /* ignore */ }
    }

    this.setData({
      openid: data.openid,
      openidShort: data.openid.slice(-8).toUpperCase(),
      roleLabel: data.roleLabel,
      isAdmin: data.role === 'admin' || data.level >= 3,
      avatarUrl,
      nickName,
      userInfo: data,
      lastActiveTime: wx.getStorageSync('lastActiveTime') || '',
      vipLabel: vipInfo.label,
      vipDaysLeft: vipInfo.daysLeft,
      vipExpiresDate
    })
  },

  // 检查是否需要设置资料（首次登录或未设置头像昵称）
  checkProfileSetup() {
    // 防止重复弹窗
    if (this.data.hasShownProfilePrompt) return
    
    const avatarUrl = wx.getStorageSync('userAvatar') || ''
    const nickName = wx.getStorageSync('userNickName') || ''
    
    // 如果本地没有头像或昵称，从权限缓存中判断（已有缓存优先）
    if (!avatarUrl || !nickName) {
      const cached = permission.getData()
      // 用缓存的昵称和头像判断
      const hasCloudProfile = cached.avatarUrl || cached.nickName

      if (!hasCloudProfile) {
        // 云端也没有资料，弹出设置框
        this.setData({
          showProfileModal: true,
          hasShownProfilePrompt: true,
          editAvatarUrl: '/images/nav_user_white.png',
          editNickName: '',
          isFirstLogin: true
        })
        wx.setStorageSync('hasShownProfilePrompt', true)
      } else {
        // 云端有资料，更新本地缓存
        if (cached.nickName) {
          wx.setStorageSync('userNickName', cached.nickName)
        }
        this.getAvatarUrl(cached.avatarUrl).then(url => {
          wx.setStorageSync('userAvatar', url)
          this.setData({ avatarUrl: url, nickName: cached.nickName || '微信用户' })
        }).catch(() => {})
        this.setData({ hasShownProfilePrompt: true })
        wx.setStorageSync('hasShownProfilePrompt', true)
      }
    } else {
      this.setData({ hasShownProfilePrompt: true })
      wx.setStorageSync('hasShownProfilePrompt', true)
    }
  },

  // 无需手动登录，启动时 app.js 已自动获取用户身份

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
      this.saveProfileToLocalAndCloud(tempAvatarUrl || '/images/nav_user_white.png', nickName)
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


  // 阻止事件冒泡
  stopTap() {
    // 空方法，仅用于阻止事件冒泡
  },

  // 同步资料到云端
  syncProfileToCloud(avatarUrl, nickName) {
    wx.cloud.callFunction({
      name: 'userManage',
      data: {
        action: 'updateProfile',
        nickName: nickName || this.data.nickName || '',
        avatarUrl: avatarUrl || this.data.avatarUrl || ''
      }
    })
  },

  // 复制用户ID
  copyOpenid() {
    const openid = wx.getStorageSync('userOpenid') || this.data.openid
    if (!openid) {
      wx.showToast({ title: '暂无用户ID', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: openid,
      success: () => {
        wx.showToast({ title: 'ID已复制', icon: 'success' })
      }
    })
  },

  // 开通正式版
  onUpgrade() {
    wx.showModal({
      title: '开通正式版',
      content: '正式版功能正在开发中，敬请期待！',
      showCancel: false,
      confirmText: '知道了'
    })
  },

  // ===== 通用功能 =====

  // 根据openid获取云存储头像URL
  getAvatarCloudPath(openid) {
    return `cloud://avatars/${openid}.jpg`
  },

  // 获取头像URL（简化版）- 强制刷新避免缓存
  async getAvatarUrl(avatarUrl) {
    console.log('getAvatarUrl called with:', avatarUrl)
    if (!avatarUrl) return '/images/nav_user_white.png'
    
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
      return '/images/nav_user_white.png'
    }
    
    // 本地默认头像
    console.log('Unknown avatar type, returning default')
    return avatarUrl || '/images/nav_user_white.png'
  },

  // ===== 通用功能 =====
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

  clearCache() {
    wx.showModal({
      title: '确认清除',
      content: '清除缓存不会影响扫描历史记录和设置，确定要清除吗？',
      success: (res) => {
        if (res.confirm) {
          // 只清理可再生缓存；身份、权限与用户配置必须保留，否则会出现「已登录但权限失效」
          const keep = [
            'scanHistory', 'settings', 'customRules', 'hideRecentScans',
            'userAvatar', 'userNickName', 'userOpenid', 'isLoggedIn',
            'loginTime', 'lastActiveTime', 'userPermission'
          ]
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
      title: '关于工具箱',
      content: '功能：扫码识别、内容解码、注册码生成解析等多款实用工具，持续上新\n开发者：工具箱团队',
      showCancel: false,
      confirmText: '知道了'
    })
  },

  // 分享
  onShareAppMessage() {
    return {
      title: '工具箱 - 多合一实用工具',
      path: '/pages/home/home',
      imageUrl: '/images/nav_scan.png'
    }
  },

  // 跳转到数据管理页面
  goToDataManage() {
    wx.navigateTo({ url: '/pages/admin/data-manage' })
  },

  // 工具配置（管理员）：名称、描述、排序与上下线
  goToToolConfig() {
    wx.navigateTo({ url: '/pages/admin/tool-config' })
  }
})
