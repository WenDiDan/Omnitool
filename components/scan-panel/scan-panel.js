const app = getApp();
const barcode = require('../../utils/barcode.js');
const imageDecoder = require('../../utils/image-decoder.js');
const { computeAllEncodeResults } = require('../../utils/encode-utils.js');

Component({
  options: { addGlobalClass: true },
  lifetimes: {
    attached() { this.onLoad && this.onLoad({}); },
    detached() { this.onUnload && this.onUnload(); }
  },
  pageLifetimes: {
    show() { this.onShow && this.onShow(); },
    hide() { this.onHide && this.onHide(); }
  },
  data: {
    showPreview: false,
    flashOn: false,
    showResult: false,
    resultHiding: false, // 结果面板退出动画中
    dragStartY: 0,      // 拖拽起始Y坐标
    dragCurrentY: 0,    // 拖拽当前偏移
    scanResult: {},
    decodedInfo: {},    // 解码详情
    encodeResults: {},  // 编码转换结果
    showEncodeTools: false,  // 是否显示编码转换
    recentScans: [],
    customRuleResults: [],  // 自定义规则提取结果
    todayCount: 0,          // 今日扫描
    totalCount: 0           // 累计扫描
  },

  methods: {
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
    const today = new Date().toDateString();
    const todayCount = history.filter(item => {
      const ts = item.timestamp || (item.time ? new Date(item.time.replace(/-/g, '/')).getTime() : 0);
      return ts && new Date(ts).toDateString() === today;
    }).length;

    this.setData({
      recentScans: history.slice(0, 10),
      todayCount,
      totalCount: history.length
    });
  },

  // 进入连续扫码独立页面
  goToContinuousScan() {
    wx.navigateTo({
      url: '/pages/continuousScan/continuousScan'
    });
  },

  // 进入二维码创建页面
  goToQRCode() {
    wx.navigateTo({
      url: '/pages/qrcode/qrcode'
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
      wx.vibrateShort({ fail: () => {} });
    }
    // 自动复制
    if (app.globalData.settings.autoCopy) {
      wx.setClipboardData({
        data: code,
        success: () => { wx.showToast({ title: '已复制', icon: 'success', duration: 1000 }); },
        fail: () => { wx.showToast({ title: '复制失败', icon: 'none' }); }
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
      resultHiding: false,
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
      resultHiding: false,
      scanResult: scanData,
      decodedInfo: decoded,
      encodeResults,
      customRuleResults,
      showEncodeTools: false
    });
  },

  // 图片解码 — 从相册识别条码/二维码
  selectFromAlbum() {
    imageDecoder.decodeFromAlbum({
      onStart: () => wx.showLoading({ title: '正在识别...' }),
      onSuccess: (code, scanType) => {
        wx.hideLoading();
        this.handleScanResult(code, scanType);
      },
      onFail: (errMsg) => {
        wx.hideLoading();
        wx.showToast({ title: errMsg, icon: 'none' });
      }
    });
  },

  // ===== 结果弹窗操作 =====

  copyResult() {
    wx.setClipboardData({
      data: this.data.scanResult.code,
      success: () => { wx.showToast({ title: '已复制', icon: 'success' }); },
      fail: () => { wx.showToast({ title: '复制失败', icon: 'none' }); }
    });
  },

  // 复制WiFi密码
  copyWifiPassword() {
    const pwd = this.data.decodedInfo.password;
    if (pwd) {
      wx.setClipboardData({
        data: pwd,
        success: () => { wx.showToast({ title: '密码已复制', icon: 'success' }); },
        fail: () => { wx.showToast({ title: '复制失败', icon: 'none' }); }
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
    wx.makePhoneCall({
      phoneNumber: phone,
      fail: () => { wx.showToast({ title: '拨号失败', icon: 'none' }); }
    });
  },

  // 发送邮件
  sendEmail() {
    const email = this.data.scanResult.code.replace(/^mailto:/i, '');
    wx.setClipboardData({
      data: email,
      success: () => { wx.showToast({ title: '邮箱已复制', icon: 'success' }); },
      fail: () => { wx.showToast({ title: '复制失败', icon: 'none' }); }
    });
  },

  // 继续扫码
  continueScan() {
    this.setData({ resultHiding: true });
    this._continueTimer = setTimeout(() => {
      this.setData({ showResult: false, resultHiding: false });
      this.startScan();
    }, 250);
  },

  closeResult() {
    if (this.data.resultHiding) return;
    this.setData({ resultHiding: true });
    setTimeout(() => {
      this.setData({ showResult: false, resultHiding: false, dragCurrentY: 0 });
    }, 250);
  },

  // 拖拽手势 — 记录起始位置
  onDragStart(e) {
    this._dragStartY = e.touches[0].clientY;
  },

  // 拖拽手势 — 实时跟随
  onDragMove(e) {
    if (!this._dragStartY || this.data.resultHiding) return;
    const dy = e.touches[0].clientY - this._dragStartY;
    if (dy > 0) {
      this.setData({ dragCurrentY: dy });
    }
  },

  // 拖拽手势 — 判断是否关闭
  onDragEnd(e) {
    if (this.data.resultHiding) return;
    const dy = this.data.dragCurrentY || 0;
    if (dy > 120) {
      this.closeResult();
    } else {
      this.setData({ dragCurrentY: 0 });
    }
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

  // 计算编码转换结果
  computeEncodeResults(code) {
    return computeAllEncodeResults(code);
  },

  // 切换编码工具展开
  toggleEncodeTools() {
    this.setData({ showEncodeTools: !this.data.showEncodeTools });
  },

  // 跳转到历史记录
  goToHistory() {
    this.setData({ resultHiding: true });
    this._historyTimer = setTimeout(() => {
      this.setData({ showResult: false, resultHiding: false });
      wx.navigateTo({ url: '/pages/history/history' });
    }, 250);
  },

  onUnload() {
    if (this._continueTimer) clearTimeout(this._continueTimer);
    if (this._historyTimer) clearTimeout(this._historyTimer);
  },

  // 复制编码结果
  copyEncodeResult(e) {
    const key = e.currentTarget.dataset.key;
    const value = this.data.encodeResults[key];
    if (value) {
      wx.setClipboardData({
        data: value,
        success: () => { wx.showToast({ title: '已复制', icon: 'success' }); },
        fail: () => { wx.showToast({ title: '复制失败', icon: 'none' }); }
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
  }
});
