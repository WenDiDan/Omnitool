const app = getApp();
const barcode = require('../../utils/barcode.js');
const { computeAllEncodeResults } = require('../../utils/encode-utils.js');

Page({
  data: {
    scanList: [],                // 本次会话扫码记录
    continuousActive: false,     // 持续扫码是否激活
    showDetailPanel: false,      // 详情弹窗
    detailData: {},              // 当前查看的详情数据
    detailDecoded: {},           // 详情解码信息
    encodeResults: {}            // 编码转换结果
  },

  onLoad() {
    this._aborted = false;       // 标记是否已中断（返回页面时置true）
  },

  onUnload() {
    this._aborted = true;
    // 停止下一次循环
    this._skipNextScan = true;
  },

  /* ========== 持续扫码 ========== */

  /**
   * 点击按钮：开始/停止持续扫码
   */
  toggleScan() {
    if (this.data.continuousActive) {
      // 手动停止
      this._aborted = true;
      this.setData({ continuousActive: false });
    } else {
      // 开始持续扫码
      this._aborted = false;
      this.setData({ continuousActive: true });
      this.doSingleScan();
    }
  },

  /**
   * 执行一次扫码，成功后自动再次扫码
   */
  doSingleScan() {
    if (this._aborted) {
      this.setData({ continuousActive: false });
      return;
    }

    wx.scanCode({
      onlyFromCamera: false,
      success: (res) => {
        this.handleScanResult(res.result, res.scanType || '');
      },
      fail: (err) => {
        // 用户取消扫码 — 视为手动停止
        if (err && err.errMsg && err.errMsg.indexOf('cancel') !== -1) {
          this._aborted = true;
          this.setData({ continuousActive: false });
          return;
        }
      },
      complete: () => {
        // 扫码完成后自动进行下一次 (除非已中断)
        // 给足时间让页面渲染结果（手机端需要更长时间）
        if (!this._aborted) {
          setTimeout(() => {
            this.doSingleScan();
          }, 1000);
        } else {
          this.setData({ continuousActive: false });
        }
      }
    });
  },

  handleScanResult(code, wxScanType) {
    // 短时间去重（3秒内相同码不重复添加）
    const dup = this.data.scanList.find(
      item => item.code === code && (Date.now() - item._ts < 3000)
    );
    if (dup) return;

    const decoded = barcode.decodeBarcode(code, wxScanType);
    const type = decoded.type || barcode.identifyBarcodeType(code, wxScanType);
    const customRuleResults = app.decodeWithRule(code);

    if (customRuleResults && customRuleResults.length > 0) {
      const first = customRuleResults[0];
      if (first.value) {
        decoded.customData = first.value;
        decoded.customLabel = first.label || '自定义';
      }
      decoded.customRuleResults = customRuleResults;
    }

    const isUrl = /^https?:\/\//i.test(code);

    const item = {
      code,
      type,
      typeColor: this.getTypeColor(type),
      isUrl,
      time: this.formatTime(new Date()),
      wxScanType,
      _ts: Date.now()
    };

    // 保存到全局历史
    app.saveScanHistory({
      code,
      type,
      time: item.time,
      wxScanType,
      count: 1,
      decodedInfo: decoded
    });

    // 音效 & 震动
    if (app.globalData.settings.soundEnabled) {
      try {
        const audio = wx.createInnerAudioContext();
        audio.src = '/images/scan_beep.wav';
        audio.play();
        audio.onEnded(() => audio.destroy());
        audio.onError(() => audio.destroy());
      } catch (e) {}
    }
    if (app.globalData.settings.vibrationEnabled) {
      wx.vibrateShort({ type: 'light' });
    }

    this.setData({
      scanList: [item, ...this.data.scanList]
    });

    // 短暂提示，让用户在进入下次扫码前看到结果
    wx.showToast({
      title: `+1  ${type}`,
      icon: 'success',
      duration: 600
    });
  },

  getTypeColor(type) {
    const map = {
      'QR_CODE': 'tag-QR_CODE',
      'EAN_13': 'tag-EAN_13', 'EAN_8': 'tag-EAN_8',
      'CODE_128': 'tag-CODE_128', 'CODE_39': 'tag-CODE_39',
      'CODE_93': 'tag-CODE_93', 'CODABAR': 'tag-CODABAR',
      'ITF': 'tag-ITF', 'PDF417': 'tag-PDF417',
      'AZTEC': 'tag-AZTEC', 'DATA_MATRIX': 'tag-DATA_MATRIX'
    };
    return map[type] || 'tag-default';
  },

  /* ========== 整体复制 ========== */

  copyAllList() {
    if (this.data.scanList.length === 0) {
      wx.showToast({ title: '无记录可复制', icon: 'none' });
      return;
    }
    const text = this.data.scanList
      .map((item, i) => `[${i + 1}] ${item.time}  ${item.type}  ${item.code}`)
      .join('\n');
    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showToast({ title: '已复制全部', icon: 'success' });
      }
    });
  },

  /* ========== 导出 ========== */

  exportList() {
    if (this.data.scanList.length === 0) {
      wx.showToast({ title: '无记录可导出', icon: 'none' });
      return;
    }
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
    const title = '连续扫码记录';
    const body = this.data.scanList
      .map((item, i) => `[${i + 1}] ${item.time}  ${item.type}\n${item.code}`)
      .join('\n\n');
    const total = `\n\n---\n共 ${this.data.scanList.length} 条记录  |  ${dateStr}`;
    const fullText = `${title}\n${'─'.repeat(20)}\n\n${body}${total}`;

    const fs = wx.getFileSystemManager();
    const filePath = `${wx.env.USER_DATA_PATH}/scan_${dateStr}_${Date.now()}.txt`;

    fs.writeFile({
      filePath,
      data: fullText,
      encoding: 'utf8',
      success: () => {
        wx.shareFileMessage({
          filePath,
          fileName: `扫码记录_${dateStr}.txt`,
          fail: () => {
            // 分享失败时，直接复制到剪贴板
            wx.setClipboardData({
              data: fullText,
              success: () => {
                wx.showToast({ title: '已复制（导出可用）', icon: 'success' });
              }
            });
          }
        });
      },
      fail: () => {
        // 写文件失败，直接复制
        wx.setClipboardData({
          data: fullText,
          success: () => {
            wx.showToast({ title: '已复制内容', icon: 'success' });
          }
        });
      }
    });
  },

  /* ========== 列表操作 ========== */

  showDetail(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.scanList[index];
    if (!item) return;

    const decoded = barcode.decodeBarcode(item.code, item.wxScanType);
    const customRuleResults = app.decodeWithRule(item.code);
    const encodeResults = computeAllEncodeResults(item.code);

    if (customRuleResults && customRuleResults.length > 0) {
      const first = customRuleResults[0];
      if (first.value) {
        decoded.customData = first.value;
        decoded.customLabel = first.label || '自定义';
      }
      decoded.customRuleResults = customRuleResults;
    }

    this.setData({
      detailData: { ...item },
      detailDecoded: decoded,
      encodeResults,
      showDetailPanel: true
    });
  },

  closeDetailPanel() {
    this.setData({ showDetailPanel: false });
  },

  copyItem(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.scanList[index];
    if (!item) return;
    wx.setClipboardData({ data: item.code });
  },

  openUrl(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.scanList[index];
    if (!item || !item.isUrl) return;
    wx.navigateTo({
      url: `/package1/pages/browser/browser?url=${encodeURIComponent(item.code)}`
    });
  },

  clearAllList() {
    wx.showModal({
      title: '确认清空',
      content: `确定清空全部 ${this.data.scanList.length} 条记录？`,
      confirmColor: '#E03E3E',
      success: (res) => {
        if (res.confirm) {
          this.setData({ scanList: [] });
        }
      }
    });
  },

  /* ========== 详情弹窗操作 ========== */

  copyDetailCode() {
    wx.setClipboardData({ data: this.data.detailData.code });
  },

  openDetailUrl() {
    const url = this.data.detailData.code;
    this.setData({ showDetailPanel: false });
    wx.navigateTo({
      url: `/package1/pages/browser/browser?url=${encodeURIComponent(url)}`
    });
  },

  goDeepDecode() {
    this.setData({ showDetailPanel: false });
    wx.navigateTo({
      url: `/pages/index/index?code=${encodeURIComponent(this.data.detailData.code)}`
    });
  },

  /* ========== 导航 ========== */

  goBack() {
    this._aborted = true;
    wx.navigateBack({ delta: 1 });
  },

  stopPropagation() {},

  formatTime(date) {
    const h = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${h}:${mi}:${s}`;
  }
});
