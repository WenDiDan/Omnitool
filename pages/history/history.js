const app = getApp();

Page({
  data: {
    historyList: []
  },

  onShow() {
    this.loadHistory();
  },

  loadHistory() {
    const raw = app.globalData.scanHistory || []
    const historyList = raw.map(item => ({
      ...item,
      typeLabel: this.getTypeLabel(item.type)
    }))
    this.setData({ historyList })
  },

  getTypeLabel(type) {
    const t = (type || '').toLowerCase()
    if (t.includes('ean') || t.includes('条形码') || t.includes('barcode') || t.includes('isbn') || t.includes('upc')) return 'EAN'
    if (t.includes('二维码') || t.includes('qr')) return 'QR'
    if (t.includes('url') || t.includes('网址') || t.includes('http')) return 'URL'
    if (t.includes('wifi') || t.includes('wi-fi')) return 'WiFi'
    if (t.includes('vcard') || t.includes('联系人')) return 'Card'
    if (t.includes('tel') || t.includes('电话')) return 'TEL'
    return (type || '?').slice(0, 3).toUpperCase()
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
    app.globalData.pendingScanCode = code;
    wx.switchTab({
      url: '/pages/scan/scan'
    });
  },

  goToScan() {
    wx.switchTab({
      url: '/pages/scan/scan'
    });
  }
});