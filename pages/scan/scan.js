const app = getApp();
const barcode = require('../../utils/barcode.js');

Page({
  data: {
    showPreview: false,
    flashOn: false,
    showResult: false,
    scanResult: {},
    decodedInfo: {},    // 解码详情
    recentScans: [],
    hideRecentScans: false,
    continuousMode: false  // 连续扫码模式
  },

  onLoad(options) {
    if (options.code) {
      this.handleScanResult(options.code);
    }
    this.loadRecentScans();
    this.loadRecentScansSetting();
  },

  onShow() {
    // 检查登录状态
    const isLoggedIn = wx.getStorageSync('isLoggedIn');
    if (!isLoggedIn) {
      wx.showModal({
        title: '提示',
        content: '请先登录后再使用扫码功能',
        showCancel: false,
        success: () => {
          wx.switchTab({ url: '/pages/my/my' });
        }
      });
      return;
    }

    // 检查是否被封禁
    const userInfo = app.globalData.userInfo;
    if (userInfo && userInfo.isBlocked) {
      wx.showModal({
        title: '无法使用',
        content: '您的账号已被封禁，无法使用扫码功能',
        showCancel: false,
        success: () => {
          wx.switchTab({ url: '/pages/my/my' });
        }
      });
      return;
    }

    if (app.globalData.pendingScanCode) {
      const code = app.globalData.pendingScanCode;
      delete app.globalData.pendingScanCode;
      this.showScanDetail(code);
    }
    this.loadRecentScans();
  },

  onHide() {
    if (this.data.showPreview) {
      this.closePreview();
    }
  },

  loadRecentScans() {
    const history = app.globalData.scanHistory || [];
    this.setData({ recentScans: history.slice(0, 5) });
  },

  loadRecentScansSetting() {
    const hideRecentScans = wx.getStorageSync('hideRecentScans') || false;
    this.setData({ hideRecentScans });
  },

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

  showRecentScans() {
    this.setData({ hideRecentScans: false });
    wx.setStorageSync('hideRecentScans', false);
    wx.showToast({ title: '已显示', icon: 'success', duration: 1000 });
  },

  // 切换连续扫码模式
  toggleContinuous() {
    this.setData({ continuousMode: !this.data.continuousMode });
    wx.showToast({
      title: this.data.continuousMode ? '连续扫码已开启' : '连续扫码已关闭',
      icon: 'none',
      duration: 1000
    });
  },

  startScan() {
    // 检查是否被封禁
    const userInfo = app.globalData.userInfo;
    if (userInfo?.isBlocked) {
      wx.showModal({
        title: '无法使用',
        content: '您的账号已被封禁，无法使用扫码功能',
        showCancel: false
      });
      return;
    }

    wx.getSetting({
      success: (res) => {
        if (res.authSetting['scope.camera']) {
          this.setData({ showPreview: true });
        } else {
          wx.authorize({
            scope: 'scope.camera',
            success: () => { this.setData({ showPreview: true }); },
            fail: () => {
              wx.showModal({
                title: '需要相机权限',
                content: '请在设置中开启相机权限以使用扫码功能',
                confirmText: '去设置',
                success: (res) => { if (res.confirm) wx.openSetting(); }
              });
            }
          });
        }
      }
    });
  },

  closePreview() {
    this.setData({ showPreview: false, flashOn: false });
  },

  // 相机扫码回调 — 保存微信返回的scanType
  onScanCode(e) {
    const code = e.detail.result;
    const scanType = e.detail.scanType || '';
    this.handleScanResult(code, scanType);
    this.closePreview();
  },

  handleScanResult(code, wxScanType) {
    // 音效
    if (app.globalData.settings.soundEnabled) {
      try {
        const audio = wx.createInnerAudioContext();
        audio.src = '/images/scan_beep.wav';
        audio.play();
        audio.onEnded(() => audio.destroy());
        audio.onError(() => audio.destroy());
      } catch (e) {}
    }
    // 震动
    if (app.globalData.settings.vibrationEnabled) {
      wx.vibrateShort();
    }
    // 自动复制
    if (app.globalData.settings.autoCopy) {
      wx.setClipboardData({
        data: code,
        success: () => { wx.showToast({ title: '已复制', icon: 'success', duration: 1000 }); }
      });
    }

    const type = barcode.identifyBarcodeType(code, wxScanType);
    const decoded = barcode.decodeBarcode(code, wxScanType);

    const scanData = {
      code,
      type,
      time: this.formatTime(new Date()),
      wxScanType: wxScanType || ''
    };

    app.saveScanHistory(scanData);

    this.setData({
      showResult: true,
      scanResult: scanData,
      decodedInfo: decoded
    });

    this.loadRecentScans();
  },

  toggleFlash() {
    this.setData({ flashOn: !this.data.flashOn });
  },

  showScanDetail(code) {
    const history = app.globalData.scanHistory || [];
    const record = history.find(item => item.code === code);
    const type = barcode.identifyBarcodeType(code, record ? record.wxScanType : '');
    const decoded = barcode.decodeBarcode(code, record ? record.wxScanType : '');
    const scanData = {
      code,
      type,
      time: record ? record.time : this.formatTime(new Date())
    };
    this.setData({
      showResult: true,
      scanResult: scanData,
      decodedInfo: decoded
    });
  },

  // 相册扫码 — 保留微信API的scanType
  selectFromAlbum() {
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['barCode', 'qrCode'],
      success: (res) => {
        this.handleScanResult(res.result, res.scanType);
      },
      fail: (err) => {
        if (err.errMsg && err.errMsg.indexOf('cancel') === -1) {
          wx.showToast({ title: '未识别到条码，请重试', icon: 'none' });
        }
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
          this.handleScanResult(res.content.trim());
        }
      }
    });
  },

  // ===== 结果弹窗操作 =====

  copyResult() {
    wx.setClipboardData({
      data: this.data.scanResult.code,
      success: () => { wx.showToast({ title: '已复制', icon: 'success' }); }
    });
  },

  // 复制WiFi密码
  copyWifiPassword() {
    const pwd = this.data.decodedInfo.password;
    if (pwd) {
      wx.setClipboardData({
        data: pwd,
        success: () => { wx.showToast({ title: '密码已复制', icon: 'success' }); }
      });
    }
  },

  // 打开URL（内置浏览器）
  openUrl() {
    const url = this.data.scanResult.code;
    if (!/^https?:\/\//i.test(url)) return;
    wx.navigateTo({
      url: `/package1/pages/browser/browser?url=${encodeURIComponent(url)}`
    });
  },

  // 拨打电话
  callPhone() {
    const phone = this.data.scanResult.code.replace(/^tel:/i, '');
    wx.makePhoneCall({ phoneNumber: phone });
  },

  // 发送邮件
  sendEmail() {
    const email = this.data.scanResult.code.replace(/^mailto:/i, '');
    wx.setClipboardData({
      data: email,
      success: () => { wx.showToast({ title: '邮箱已复制', icon: 'success' }); }
    });
  },

  searchResult() {
    const code = this.data.scanResult.code;
    wx.showActionSheet({
      itemList: ['百度搜索', '商品搜索(淘宝)', '复制内容'],
      success: (res) => {
        switch (res.tapIndex) {
          case 0:
            wx.navigateTo({
              url: `/package1/pages/browser/browser?url=${encodeURIComponent('https://www.baidu.com/s?wd=' + code)}&type=search`
            });
            break;
          case 1:
            wx.navigateTo({
              url: `/package1/pages/browser/browser?url=${encodeURIComponent('https://s.taobao.com/search?q=' + code)}&type=search`
            });
            break;
          case 2:
            wx.setClipboardData({
              data: code,
              success: () => { wx.showToast({ title: '已复制', icon: 'success' }); }
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

  // 继续扫码（连续模式）
  continueScan() {
    this.setData({ showResult: false });
    this.startScan();
  },

  closeResult() {
    this.setData({ showResult: false });
    // 连续扫码模式下关闭弹窗自动重新扫码
    if (this.data.continuousMode) {
      setTimeout(() => { this.startScan(); }, 300);
    }
  },

  stopPropagation() {},

  goToHistory() {
    wx.navigateTo({ url: '/pages/history/history' });
  },

  viewDetail(e) {
    const code = e.currentTarget.dataset.code;
    this.showScanDetail(code);
  },

  onCameraStop() {},

  onCameraError(e) {
    console.error('相机错误', e);
    wx.showModal({
      title: '相机错误',
      content: '无法访问相机，请检查权限设置',
      confirmText: '去设置',
      success: (res) => { if (res.confirm) wx.openSetting(); }
    });
    this.closePreview();
  },

  formatTime(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${d} ${h}:${mi}:${s}`;
  }
});
