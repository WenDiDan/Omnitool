const app = getApp();

Page({
  data: {
    historyList: []
  },

  onShow() {
    this.loadHistory();
  },

  loadHistory() {
    this.setData({
      historyList: app.globalData.scanHistory || []
    });
  },

  clearHistory() {
    wx.showModal({
      title: '确认清空',
      content: '确定要清空所有历史记录吗？',
      success: (res) => {
        if (res.confirm) {
          app.clearScanHistory();
          this.loadHistory();
          wx.showToast({ title: '已清空', icon: 'success' });
        }
      }
    });
  },

  viewDetail(e) {
    const code = e.currentTarget.dataset.code;
    wx.navigateTo({
      url: `/pages/scan/scan?code=${encodeURIComponent(code)}`
    });
  },

  goToScan() {
    wx.switchTab({
      url: '/pages/scan/scan'
    });
  }
});