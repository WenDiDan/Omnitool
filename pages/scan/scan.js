const app = getApp();

Page({
  data: {
    showPreview: false,     // 是否显示相机预览
    flashOn: false,
    showResult: false,
    scanResult: {},
    recentScans: [],
    hideRecentScans: false   // 是否隐藏最近扫描记录
  },

  onLoad(options) {
    if (options.code) {
      this.handleScanResult(options.code);
    }
    this.loadRecentScans();
    this.loadRecentScansSetting();  // 加载设置
  },

  onShow() {
    this.loadRecentScans();
  },

  onHide() {
    if (this.data.showPreview) {
      this.closePreview();
    }
  },

  loadRecentScans() {
    const history = app.globalData.scanHistory || [];
    this.setData({
      recentScans: history.slice(0, 5)
    });
  },

  // 加载最近扫描记录的显示设置
  loadRecentScansSetting() {
    const hideRecentScans = wx.getStorageSync('hideRecentScans') || false;
    this.setData({ hideRecentScans });
  },

  // 关闭最近扫描记录
  closeRecentScans() {
    wx.showModal({
      title: '提示',
      content: '关闭后可以通过点击提示条重新显示，确定要关闭吗？',
      success: (res) => {
        if (res.confirm) {
          this.setData({ hideRecentScans: true });
          wx.setStorageSync('hideRecentScans', true);
          wx.showToast({ title: '已关闭', icon: 'success', duration: 1000 });
        }
      }
    });
  },

  // 重新显示最近扫描记录
  showRecentScans() {
    this.setData({ hideRecentScans: false });
    wx.setStorageSync('hideRecentScans', false);
    wx.showToast({ title: '已显示', icon: 'success', duration: 1000 });
  },

  // 开始扫码（点击按钮触发）
  startScan() {
    wx.getSetting({
      success: (res) => {
        if (res.authSetting['scope.camera']) {
          this.setData({ showPreview: true });
        } else {
          wx.authorize({
            scope: 'scope.camera',
            success: () => {
              this.setData({ showPreview: true });
            },
            fail: () => {
              wx.showModal({
                title: '需要相机权限',
                content: '请在设置中开启相机权限以使用扫码功能',
                confirmText: '去设置',
                success: (res) => {
                  if (res.confirm) {
                    wx.openSetting();
                  }
                }
              });
            }
          });
        }
      }
    });
  },

  // 关闭预览
  closePreview() {
    this.setData({ 
      showPreview: false,
      flashOn: false 
    });
  },

  onScanCode(e) {
    const result = e.detail.result;
    this.handleScanResult(result);
    this.closePreview();
  },

  handleScanResult(code) {
    if (app.globalData.settings.vibrationEnabled) {
      wx.vibrateShort();
    }

    if (app.globalData.settings.autoCopy) {
      wx.setClipboardData({
        data: code,
        success: () => {
          wx.showToast({ title: '已复制', icon: 'success', duration: 1000 });
        }
      });
    }

    const type = this.identifyBarcodeType(code);
    
    const scanData = {
      code: code,
      type: type,
      time: this.formatTime(new Date())
    };

    app.saveScanHistory(scanData);

    this.setData({
      showResult: true,
      scanResult: scanData
    });
    
    this.loadRecentScans();
  },

  identifyBarcodeType(code) {
    if (/^\d{13}$/.test(code)) return 'EAN-13';
    if (/^\d{12}$/.test(code)) return 'EAN-12';
    if (/^\d{8}$/.test(code)) return 'EAN-8';
    if (/^\d{10}$/.test(code)) return 'UPC-A';
    if (/^\d{6}$/.test(code)) return 'UPC-E';
    if (/^https?:\/\//.test(code)) return 'URL';
    if (/^\d+$/.test(code)) return '数字条码';
    return '二维码/文本';
  },

  toggleFlash() {
    this.setData({ flashOn: !this.data.flashOn });
  },

  selectFromAlbum() {
    wx.chooseImage({
      count: 1,
      sizeType: ['original'],
      sourceType: ['album'],
      success: (res) => {
        wx.showLoading({ title: '识别中...' });
        wx.scanCode({
          onlyFromCamera: false,
          success: (res) => {
            wx.hideLoading();
            this.handleScanResult(res.result);
          },
          fail: () => {
            wx.hideLoading();
            wx.showToast({ title: '未识别到条码', icon: 'none' });
          }
        });
      }
    });
  },

  manualInput() {
    wx.showModal({
      title: '手动输入',
      content: '请输入条码内容',
      editable: true,
      placeholderText: '输入条码数字或文本',
      success: (res) => {
        if (res.confirm && res.content) {
          this.handleScanResult(res.content);
        }
      }
    });
  },

  copyResult() {
    wx.setClipboardData({
      data: this.data.scanResult.code,
      success: () => {
        wx.showToast({ title: '已复制', icon: 'success' });
      }
    });
  },

  searchResult() {
    const code = this.data.scanResult.code;
    wx.showActionSheet({
      itemList: ['百度搜索', '商品搜索', '复制链接'],
      success: (res) => {
        switch (res.tapIndex) {
          case 0:
            wx.navigateTo({
              url: `/package1/pages/browser/browser?url=${encodeURIComponent('https://www.baidu.com/s?wd=' + code)}`
            });
            break;
          case 1:
            wx.navigateTo({
              url: `/package1/pages/browser/browser?url=${encodeURIComponent('https://s.taobao.com/search?q=' + code)}`
            });
            break;
          case 2:
            wx.setClipboardData({
              data: code,
              success: () => {
                wx.showToast({ title: '已复制', icon: 'success' });
              }
            });
            break;
        }
      }
    });
  },

  decodeResult() {
    this.closeResult();
    wx.navigateTo({
      url: `/pages/index/index?code=${encodeURIComponent(this.data.scanResult.code)}`
    });
  },

  closeResult() {
    this.setData({ showResult: false });
  },

  stopPropagation() {},

  goToHistory() {
    wx.navigateTo({
      url: '/pages/history/history'
    });
  },

  viewDetail(e) {
    const code = e.currentTarget.dataset.code;
    this.handleScanResult(code);
  },

  onCameraStop() {},

  onCameraError(e) {
    console.error('相机错误', e);
    wx.showModal({
      title: '相机错误',
      content: '无法访问相机，请检查权限设置',
      confirmText: '去设置',
      success: (res) => {
        if (res.confirm) {
          wx.openSetting();
        }
      }
    });
    this.closePreview();
  },

  formatTime(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    const second = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  }
});