// app.js
App({
  onLaunch() {
    // 展示本地存储能力
    const logs = wx.getStorageSync('logs') || []
    logs.unshift(Date.now())
    wx.setStorageSync('logs', logs)

    // 登录
    wx.login({
      success: res => {
        // 发送 res.code 到后台换取 openId, sessionKey, unionId
      }
    })
  },
  onLoad:function (options) {
    wx.stopPullDownRefresh() 
    var that = this;
    //刷新完成后停止下拉刷新动效
    //后面的业务代码大家自行发挥
  },
  globalData: {
    userInfo: null,
    items: ['A', 'B', 'C','A-1'],
    start:'',
    stop:'',
    rec:'2',
  },
})
