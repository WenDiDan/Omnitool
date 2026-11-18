const app = getApp();
const barcode = require('../../../../utils/barcode.js');
const imageDecoder = require('../../../../utils/image-decoder.js');
const scanUtils = require('../../utils/scan-utils.js');
const historyStore = require('../../../../utils/history-store.js');

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
    recentScans: [],
    customRuleResults: [],  // 自定义规则提取结果
    todayCount: 0,          // 今日扫描
    totalCount: 0,          // 累计扫描
    todayPercent: 0         // 今日占累计的比例（仅展示换算）
  },

  methods: {
  onLoad(options) {
    if (options.code) {
      this.handleScanResult(options.code);
    }
    this.loadRecentScans();
  },

  onShow() {
    // 首次进入扫码页：attached 阶段已加载过最近记录，这里不重复计算
    if (app.globalData.isFirstShow) {
      app.globalData.isFirstShow = false;
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
    // 用数值日界比较，避免对每条记录都创建 Date 再格式化字符串
    const { start, end } = scanUtils.getTodayRange();
    let todayRecords = 0;
    for (const item of history) {
      const ts = scanUtils.getRecordTs(item);
      if (ts >= start && ts < end) todayRecords++;
    }

    // 累计/今日次数取自独立统计（每次扫码事件 +1，清空历史不清零）
    // 老用户首次读取时用现有记录播种，保证升级后数字不倒退
    let stats = historyStore.getScanStats();
    if (stats.migrated !== true) {
      stats.total = Math.max(stats.total || 0, history.length);
      stats.today = Math.max(stats.today || 0, todayRecords);
      stats.migrated = true;
      historyStore.setScanStats(stats);
    }
    const totalCount = Math.max(stats.total || 0, history.length);

    this.setData({
      recentScans: history.slice(0, 10),
      todayCount: stats.today || 0,
      totalCount,
      todayPercent: totalCount ? Math.round(((stats.today || 0) / totalCount) * 100) : 0
    });
  },

  // 进入连续扫码独立页面
  goToContinuousScan() {
    wx.navigateTo({
      url: '/pages/scan/continuousScan/continuousScan'
    });
  },

  // 进入二维码创建页面
  goToQRCode() {
    wx.navigateTo({
      url: '/pages/scan/qrcode/qrcode'
    });
  },

  startScan() {
    wx.scanCode({
      onlyFromCamera: true,
      scanType: ['barCode', 'qrCode', 'datamatrix', 'pdf417'],
      success: (res) => {
        if (res && res.result) this.handleScanResult(res.result, res.scanType);
        else wx.showToast({ title: '未识别到内容，请重试', icon: 'none' });
      },
      fail: (err) => {
        // 用户主动取消不提示
        if (!scanUtils.isCancelError(err)) {
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
    const detail = (e && e.detail) || {};
    const code = detail.result;
    if (!code) {
      this.closePreview();
      wx.showToast({ title: '未识别到内容，请重试', icon: 'none' });
      return;
    }
    this.handleScanResult(code, detail.scanType || '');
    this.closePreview();
  },

  handleScanResult(code, wxScanType) {
    const content = String(code || '').trim();
    if (!content) {
      wx.showToast({ title: '未识别到内容，请重试', icon: 'none' });
      return;
    }
    code = content;

    // 检查重复扫码
    const history = app.globalData.scanHistory || [];
    const existingRecord = history.find(item => item.code === code);
    const count = existingRecord ? existingRecord.count + 1 : 1;

    // 重复扫码次数已在结果面板右上角展示，不再弹居中 toast 遮挡内容

    // 音效（公共单实例，避免每次扫码新建/销毁）
    if (app.globalData.settings.soundEnabled) scanUtils.playBeep();
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

    const { decoded, customRuleResults } = this.buildResultView(code, wxScanType);

    const scanData = {
      code,
      codeHead: code.slice(0, 3), // 供模板展示条码结构，WXML 不支持 substring
      type: decoded.type,
      time: scanUtils.formatDateTime(new Date()),
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
      customRuleResults
    });

    this.loadRecentScans();
  },

  toggleFlash() {
    this.setData({ flashOn: !this.data.flashOn });
  },

  showScanDetail(code) {
    const history = app.globalData.scanHistory || [];
    const record = history.find(item => item.code === code);
    // 始终重新解码，确保显示最新的解析结果（规则可能已被修改）
    const { decoded, customRuleResults } = this.buildResultView(code, record ? record.wxScanType : '');

    const scanData = {
      code,
      codeHead: code.slice(0, 3),
      type: decoded.type,
      time: record ? record.time : scanUtils.formatDateTime(new Date()),
      count: record ? record.count : 1
    };
    this.setData({
      showResult: true,
      resultHiding: false,
      scanResult: scanData,
      decodedInfo: decoded,
      customRuleResults
    });
  },

  // 统一构建解码结果（扫码与历史详情共用，避免逻辑分叉）
  // 说明：decodeBarcode 内部已完成类型识别，无需再调用 identifyBarcodeType；
  //      解码异常时降级为原文展示，保证结果面板始终可用。
  buildResultView(code, wxScanType) {
    let decoded;
    try {
      decoded = barcode.decodeBarcode(code, wxScanType);
    } catch (err) {
      console.error('[扫码] 解码失败', err);
      decoded = scanUtils.fallbackDecoded(code);
    }
    const customRuleResults = app.decodeWithRule ? app.decodeWithRule(code) : [];
    scanUtils.mergeCustomRuleResults(decoded, customRuleResults);
    return { decoded, customRuleResults };
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
    scanUtils.copyText(this.data.scanResult.code, '已复制');
  },

  // 复制WiFi密码
  copyWifiPassword() {
    const pwd = this.data.decodedInfo.password;
    if (pwd) scanUtils.copyText(pwd, '密码已复制');
  },

  // 复制链接（小程序内不内置网页浏览，交由系统浏览器打开）
  copyUrl() {
    const url = this.data.scanResult.code;
    if (!/^https?:\/\//i.test(url)) return;
    scanUtils.copyText(url, '链接已复制，请到浏览器打开');
  },

  // 拨打电话
  callPhone() {
    const phone = String(this.data.scanResult.code || '').replace(/^tel:/i, '');
    if (!phone) return;
    wx.makePhoneCall({
      phoneNumber: phone,
      fail: () => { wx.showToast({ title: '拨号失败', icon: 'none' }); }
    });
  },

  // 发送邮件
  sendEmail() {
    const email = String(this.data.scanResult.code || '').replace(/^mailto:/i, '');
    scanUtils.copyText(email, '邮箱已复制');
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
    this._closeTimer = setTimeout(() => {
      this.setData({ showResult: false, resultHiding: false, dragCurrentY: 0 });
    }, 250);
  },

  // 拖拽手势 — 记录起始位置
  onDragStart(e) {
    this._dragStartY = e.touches[0].clientY;
    this._dragLastTs = 0;
  },

  // 拖拽手势 — 实时跟随（16ms 节流，避免每帧都 setData）
  onDragMove(e) {
    if (!this._dragStartY || this.data.resultHiding) return;
    const dy = e.touches[0].clientY - this._dragStartY;
    if (dy <= 0) return;
    const now = Date.now();
    if (this._dragLastTs && now - this._dragLastTs < 16) return;
    this._dragLastTs = now;
    this.setData({ dragCurrentY: dy });
  },

  // 拖拽手势 — 判断是否关闭（用松手位置计算最终位移，避免节流丢帧）
  onDragEnd(e) {
    if (this.data.resultHiding) return;
    const endTouch = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0]);
    const dy = this._dragStartY && endTouch
      ? endTouch.clientY - this._dragStartY
      : (this.data.dragCurrentY || 0);
    this._dragStartY = 0;
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

  // 跳转到历史记录
  goToHistory() {
    this.setData({ resultHiding: true });
    this._historyTimer = setTimeout(() => {
      this.setData({ showResult: false, resultHiding: false });
      wx.navigateTo({ url: '/pages/scan/history/history' });
    }, 250);
  },

  onUnload() {
    if (this._continueTimer) clearTimeout(this._continueTimer);
    if (this._historyTimer) clearTimeout(this._historyTimer);
    if (this._closeTimer) clearTimeout(this._closeTimer);
    scanUtils.disposeBeep();
  }
  }
});
