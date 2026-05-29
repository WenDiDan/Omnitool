const app = getApp();

Page({
  data: {
    todayCount: 0,
    totalCount: 0
  },

  onShow() {
    this.loadStats();
  },

  loadStats() {
    const history = app.globalData.scanHistory || [];
    const today = new Date().toDateString();
    
    const todayCount = history.filter(item => {
      const itemDate = new Date(item.timestamp).toDateString();
      return itemDate === today;
    }).length;
    
    this.setData({
      todayCount: todayCount,
      totalCount: history.length
    });
  },

  goToScan() {
    wx.switchTab({ url: '/pages/scan/scan' });
  },

  goToDecode() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  goToHistory() {
    wx.navigateTo({ url: '/pages/history/history' });
  }
});
