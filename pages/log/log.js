const app = getApp()

Page({
  data: {
    logList: [],
    allLogs: [],
    filterType: 'all',
    loading: true,
    totalCount: 0,
    todayCount: 0,
    loginCount: 0,
    scanCount: 0
  },

  onLoad() {
    this.loadLogs()
  },

  onPullDownRefresh() {
    this.loadLogs(() => {
      wx.stopPullDownRefresh()
      wx.showToast({ title: '刷新完成', icon: 'none', duration: 800 })
    })
  },

  setFilter(e) {
    const type = e.currentTarget.dataset.type
    this.setData({ filterType: type })
    this.applyFilter(type)
  },

  applyFilter(type) {
    let filtered = this.data.allLogs
    if (type !== 'all') {
      filtered = this.data.allLogs.filter(item => item.type === type)
    }
    this.setData({ logList: filtered })
  },

  loadLogs(callback) {
    this.setData({ loading: true })

    const logs = []
    const today = this.formatDate(new Date())
    let todayCount = 0
    let loginCount = 0
    let scanCount = 0

    // 1. 登录记录
    const loginTime = wx.getStorageSync('loginTime')
    const lastActive = wx.getStorageSync('lastActiveTime')
    const openid = wx.getStorageSync('userOpenid')
    const nickName = wx.getStorageSync('userNickName') || '微信用户'

    if (loginTime) {
      const isToday = loginTime.startsWith(today)
      if (isToday) todayCount++
      loginCount++
      logs.push({
        id: 'login_' + loginTime,
        type: 'login',
        title: '用户登录',
        desc: `用户「${nickName}」登录成功`,
        time: loginTime,
        timeStr: this.formatTimeStr(loginTime),
        icon: '/images/icon_user_white.png'
      })
    }

    if (lastActive && lastActive !== loginTime) {
      const isToday = lastActive.startsWith(today)
      if (isToday) todayCount++
      logs.push({
        id: 'active_' + lastActive,
        type: 'login',
        title: '活跃更新',
        desc: '用户活跃状态更新',
        time: lastActive,
        timeStr: this.formatTimeStr(lastActive),
        icon: '/images/icon_user_white.png'
      })
    }

    // 2. 扫码记录
    const scanHistory = app.globalData.scanHistory || []
    scanHistory.forEach((item, index) => {
      const isToday = item.time && item.time.startsWith(today)
      if (isToday) todayCount++
      scanCount++
      logs.push({
        id: 'scan_' + (item.timestamp || index),
        type: 'scan',
        title: '扫码识别',
        desc: `识别类型：${item.type || '条码'}`,
        detail: item.code || '',
        time: item.time,
        timeStr: this.formatTimeStr(item.time),
        icon: '/images/icon_scan.png'
      })
    })

    // 3. 管理操作记录（从本地存储读取）
    const adminLogs = wx.getStorageSync('adminLogs') || []
    adminLogs.forEach((item, index) => {
      const isToday = item.time && item.time.startsWith(today)
      if (isToday) todayCount++
      logs.push({
        id: 'admin_' + index + '_' + (item.time || ''),
        type: 'admin',
        title: item.title || '管理操作',
        desc: item.desc || '',
        time: item.time,
        timeStr: this.formatTimeStr(item.time),
        icon: '/images/icon_settings_white.png'
      })
    })

    // 按时间倒序排列
    logs.sort((a, b) => {
      const ta = a.time || ''
      const tb = b.time || ''
      return tb.localeCompare(ta)
    })

    this.setData({
      allLogs: logs,
      logList: logs,
      loading: false,
      totalCount: logs.length,
      todayCount,
      loginCount,
      scanCount
    })

    if (callback) callback()
  },

  formatDate(date) {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  },

  formatTimeStr(timeStr) {
    if (!timeStr) return ''
    const now = new Date()
    const today = this.formatDate(now)
    const yesterday = this.formatDate(new Date(now.getTime() - 86400000))

    if (timeStr.startsWith(today)) {
      return '今天 ' + timeStr.substring(11, 16)
    }
    if (timeStr.startsWith(yesterday)) {
      return '昨天 ' + timeStr.substring(11, 16)
    }
    return timeStr.substring(5, 16).replace('-', '/')
  }
})
