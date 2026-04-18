const app = getApp();

Page({
  data: {
    totalCount: 0,
    cacheSize: '0KB'
  },

  onShow() {
    this.loadData();
    this.calculateCacheSize();
  },

  loadData() {
    const history = app.globalData.scanHistory || [];
    this.setData({
      totalCount: history.length
    });
  },

  calculateCacheSize() {
    try {
      const info = wx.getStorageInfoSync();
      const size = (info.currentSize / 1024).toFixed(2);
      this.setData({
        cacheSize: size + 'KB'
      });
    } catch (e) {
      console.error('获取缓存大小失败', e);
    }
  },

  goToHistory() {
    wx.navigateTo({
      url: '/pages/history/history'
    });
  },

  goToSettings() {
    wx.navigateTo({
      url: '/package1/pages/settings/settings'
    });
  },

  clearCache() {
    wx.showModal({
      title: '确认清除',
      content: '清除缓存不会影响扫描历史记录，确定要清除吗？',
      success: (res) => {
        if (res.confirm) {
          wx.clearStorageSync();
          this.calculateCacheSize();
          wx.showToast({ title: '缓存已清除', icon: 'success' });
        }
      }
    });
  },

  showAbout() {
    wx.showModal({
      title: '关于条码扫描器',
      content: '版本：1.0.0\n功能：快速扫描条码、二维码，智能解码，历史记录管理\n开发者：条码扫描器团队',
      showCancel: false,
      confirmText: '知道了'
    });
  }
});