const app = getApp();
const barcode = require('../../utils/barcode.js');

Page({
  data: {
    showPreview: false,
    flashOn: false,
    showResult: false,
    scanResult: {},
    decodedInfo: {},    // 解码详情
    encodeResults: {},  // 编码转换结果
    showEncodeTools: false,  // 是否显示编码转换
    recentScans: [],
    continuousMode: false,  // 连续扫码模式
    customRuleResults: []  // 自定义规则提取结果

  },

  onLoad(options) {
    if (options.code) {
      this.handleScanResult(options.code);
    }
    this.loadRecentScans();
  },

  onShow() {
    // 每次小程序启动后首次进入扫码页时，刷新为初始状态
    if (app.globalData.isFirstShow) {
      app.globalData.isFirstShow = false;
      this.loadRecentScans();
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
    this.setData({ recentScans: history.slice(0, 10) });
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
    wx.scanCode({
      onlyFromCamera: true,
      scanType: ['barCode', 'qrCode', 'datamatrix', 'pdf417'],
      success: (res) => {
        this.handleScanResult(res.result, res.scanType);
      },
      fail: (err) => {
        if (err.errMsg && err.errMsg.indexOf('cancel') === -1) {
          wx.showToast({ title: '扫码失败，请重试', icon: 'none' });
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
    // 检查重复扫码
    const history = app.globalData.scanHistory || [];
    const existingRecord = history.find(item => item.code === code);
    const count = existingRecord ? existingRecord.count + 1 : 1;

    // 显示重复扫码提示
    if (count > 1) {
      wx.showToast({
        title: `第 ${count} 次扫码`,
        icon: 'none',
        duration: 1500
      });
    }

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
    const encodeResults = this.computeEncodeResults(code);
    const customRuleResults = app.decodeWithRule(code);

    // 整合自定义规则结果到 decoded 对象中
    // 优先使用 app.decodeWithRule 的结果（支持日期转换）
    if (customRuleResults && customRuleResults.length > 0) {
      const firstResult = customRuleResults[0];
      if (firstResult.value) {
        decoded.customData = firstResult.value;
        decoded.customLabel = firstResult.label || '自定义';
      }
      // 保存完整结果供显示使用
      decoded.customRuleResults = customRuleResults;
    }

    const scanData = {
      code,
      type,
      time: this.formatTime(new Date()),
      wxScanType: wxScanType || '',
      count: count,
      decodedInfo: decoded
    };

    app.saveScanHistory(scanData);

    this.setData({
      showResult: true,
      scanResult: scanData,
      decodedInfo: decoded,
      encodeResults,
      customRuleResults,
      showEncodeTools: false
    });

    this.loadRecentScans();
  },

  toggleFlash() {
    this.setData({ flashOn: !this.data.flashOn });
  },

  showScanDetail(code) {
    const history = app.globalData.scanHistory || [];
    const record = history.find(item => item.code === code);
    const encodeResults = this.computeEncodeResults(code);
    const customRuleResults = app.decodeWithRule(code);
    
    // 始终重新解码，确保显示最新的解析结果
    const type = barcode.identifyBarcodeType(code, record ? record.wxScanType : '');
    const decoded = barcode.decodeBarcode(code, record ? record.wxScanType : '');
    
    // 整合自定义规则结果到 decoded 对象中
    if (customRuleResults && customRuleResults.length > 0) {
      const firstResult = customRuleResults[0];
      if (firstResult.value) {
        decoded.customData = firstResult.value;
        decoded.customLabel = firstResult.label || '自定义';
      }
      decoded.customRuleResults = customRuleResults;
    }
    
    const scanData = {
      code,
      type: decoded.type || type,
      time: record ? record.time : this.formatTime(new Date()),
      count: record ? record.count : 1
    };
    this.setData({
      showResult: true,
      scanResult: scanData,
      decodedInfo: decoded,
      encodeResults,
      customRuleResults,
      showEncodeTools: false
    });
  },

  // 相册扫码 — 直接打开相册选择图片
  selectFromAlbum() {
    wx.chooseImage({
      count: 1,
      sourceType: ['album'],
      success: (res) => {
        const tempFilePath = res.tempFilePaths[0];
        wx.showLoading({ title: '正在识别...' });
        wx.scanCode({
          onlyFromCamera: false,
          imageFile: tempFilePath,
          success: (scanRes) => {
            wx.hideLoading();
            this.handleScanResult(scanRes.result, scanRes.scanType);
          },
          fail: () => {
            wx.hideLoading();
            wx.showToast({ title: '未识别到条码/二维码', icon: 'none' });
          }
        });
      },
      fail: (err) => {
        if (err.errMsg && err.errMsg.indexOf('cancel') === -1) {
          wx.showToast({ title: '无法访问相册', icon: 'none' });
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
  },

  // 关闭相机预览
  closePreview() {
    this.setData({ showPreview: false, flashOn: false });
  },

  // 计算编码转换结果
  computeEncodeResults(code) {
    const tools = barcode.encodeTools;
    const results = {};

    // Base64
    try {
      results.base64Encode = tools.base64Encode(code);
      if (tools.isBase64(code)) {
        results.base64Decode = tools.base64Decode(code);
      }
    } catch (e) {}

    // URL
    results.urlEncode = tools.urlEncode(code);
    if (tools.hasUrlEncode(code)) {
      results.urlDecode = tools.urlDecode(code);
    }

    // Unicode
    results.unicodeEncode = tools.unicodeEncode(code);
    if (tools.hasUnicode(code)) {
      results.unicodeDecode = tools.unicodeDecode(code);
    }

    // HTML
    results.htmlEncode = tools.htmlEncode(code);
    if (tools.hasHtmlEntity(code)) {
      results.htmlDecode = tools.htmlDecode(code);
    }

    return results;
  },

  // 切换编码工具展开
  toggleEncodeTools() {
    this.setData({ showEncodeTools: !this.data.showEncodeTools });
  },

  // 跳转到历史记录
  goToHistory() {
    this.setData({ showResult: false });
    wx.navigateTo({ url: '/pages/history/history' });
  },

  // 复制编码结果
  copyEncodeResult(e) {
    const key = e.currentTarget.dataset.key;
    const value = this.data.encodeResults[key];
    if (value) {
      wx.setClipboardData({
        data: value,
        success: () => { wx.showToast({ title: '已复制', icon: 'success' }); }
      });
    }
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
