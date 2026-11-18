const app = getApp();
const barcode = require('../../../utils/barcode.js');
const { computeAllEncodeResults } = require('../../../utils/encode-utils.js');
const scanUtils = require('../utils/scan-utils.js');

Page({
  data: {
    scanList: [],                // 本次会话扫码记录
    continuousActive: false,     // 持续扫码是否激活
    expandedIndex: -1,           // 当前展开的记录索引，-1 表示无展开
    expandedDetail: {}           // 当前展开记录的详情数据
  },

  onLoad() {
    this._aborted = false;       // 标记是否已中断（返回页面时置true）
    this._failCount = 0;         // 连续失败次数，避免异常时无限重试
  },

  onUnload() {
    this._aborted = true;
    this._skipNextScan = true;
    if (this._scanTimer) clearTimeout(this._scanTimer);
    this.cleanupAllExportedFiles();
    scanUtils.disposeBeep();
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
      this._failCount = 0;
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
        if (scanUtils.isCancelError(err)) {
          this._aborted = true;
          this.setData({ continuousActive: false });
          return;
        }
        // 连续失败保护：避免相机/权限异常时无限自动重试
        this._failCount = (this._failCount || 0) + 1;
        if (this._failCount >= 3) {
          this._aborted = true;
          this.setData({ continuousActive: false });
          wx.showToast({ title: '连续扫码多次失败，已停止', icon: 'none' });
        }
      },
      complete: () => {
        // 扫码完成后自动进行下一次 (除非已中断)
        // 给足时间让页面渲染结果（手机端需要更长时间）
        if (!this._aborted) {
          this._scanTimer = setTimeout(() => {
            this.doSingleScan();
          }, 1000);
        } else {
          this.setData({ continuousActive: false });
        }
      }
    });
  },

  handleScanResult(code, wxScanType) {
    const content = String(code || '').trim();
    if (!content) return;
    code = content;
    this._failCount = 0; // 成功一次即重置失败计数

    // 短时间去重（3秒内相同码不重复添加）
    const dup = this.data.scanList.find(
      item => item.code === content && (Date.now() - item._ts < 3000)
    );
    if (dup) return;

    let decoded
    try {
      decoded = barcode.decodeBarcode(content, wxScanType)
    } catch (err) {
      console.error('[连续扫码] 解码失败', err)
      decoded = scanUtils.fallbackDecoded(content)
    }
    const type = decoded.type;
    const customRuleResults = app.decodeWithRule(content);
    scanUtils.mergeCustomRuleResults(decoded, customRuleResults);

    const isUrl = /^https?:\/\//i.test(code);

    const item = {
      code,
      type,
      typeColor: this.getTypeColor(type),
      isUrl,
      time: this.formatClockTime(new Date()),
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

    // 音效 & 震动（音效使用公共单实例）
    if (app.globalData.settings.soundEnabled) scanUtils.playBeep();
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
    scanUtils.copyText(text, '已复制全部');
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
        this._exportedFiles = this._exportedFiles || [];
        this._exportedFiles.push(filePath);
        wx.shareFileMessage({
          filePath,
          fileName: `扫码记录_${dateStr}.txt`,
          fail: () => {
            // 分享失败时降级为复制到剪贴板
            scanUtils.copyText(fullText, '已复制（导出可用）');
          },
          complete: () => this.cleanupExportedFile(filePath)
        });
      },
      fail: () => {
        // 写文件失败，降级为复制到剪贴板
        scanUtils.copyText(fullText, '已复制内容');
      }
    });
  },

  /** 分享结束后延迟删除临时文件，避免长期占用用户存储 */
  cleanupExportedFile(filePath, delay = 2000) {
    if (!filePath) return;
    setTimeout(() => {
      try {
        wx.getFileSystemManager().unlink({ filePath, fail: () => {} });
      } catch (e) { /* 忽略 */ }
      this._exportedFiles = (this._exportedFiles || []).filter(p => p !== filePath);
    }, delay);
  },

  /** 页面卸载时兜底清理所有导出文件 */
  cleanupAllExportedFiles() {
    const fs = wx.getFileSystemManager();
    (this._exportedFiles || []).forEach((filePath) => {
      try {
        fs.unlink({ filePath, fail: () => {} });
      } catch (e) { /* 忽略 */ }
    });
    this._exportedFiles = [];
  },

  /* ========== 列表操作 ========== */

  /**
   * 点击「详情/收起」按钮，内联展开/收起该条记录的详情
   */
  toggleDetail(e) {
    const index = e.currentTarget.dataset.index;
    // 点击已展开的记录 → 收起
    if (this.data.expandedIndex === index) {
      this.setData({ expandedIndex: -1, expandedDetail: {} });
      return;
    }

    const item = this.data.scanList[index];
    if (!item) return;

    let decoded
    try {
      decoded = barcode.decodeBarcode(item.code, item.wxScanType)
    } catch (err) {
      console.error('[连续扫码] 详情解码失败', err)
      decoded = scanUtils.fallbackDecoded(item.code)
    }
    const customRuleResults = app.decodeWithRule(item.code);
    const encodeResults = computeAllEncodeResults(item.code);
    scanUtils.mergeCustomRuleResults(decoded, customRuleResults);

    this.setData({
      expandedIndex: index,
      expandedDetail: {
        code: item.code,
        codeLength: item.code.length,
        country: decoded.country || '',
        domain: decoded.domain || '',
        customData: decoded.customData || '',
        customLabel: decoded.customLabel || ''
      },
      encodeResults
    });
  },

  copyItem(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.scanList[index];
    if (!item) return;
    scanUtils.copyText(item.code, '');
  },

  // 复制链接（小程序内不内置网页浏览，交由系统浏览器打开）
  copyUrl(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.scanList[index];
    if (!item || !item.isUrl) return;
    scanUtils.copyText(item.code, '链接已复制，请到浏览器打开');
  },

  clearAllList() {
    wx.showModal({
      title: '确认清空',
      content: `确定清空全部 ${this.data.scanList.length} 条记录？`,
      confirmColor: '#E03E3E',
      success: (res) => {
        if (res.confirm) {
          this.setData({ scanList: [], expandedIndex: -1, expandedDetail: {} });
        }
      }
    });
  },

  /* ========== 展开详情内联操作 ========== */

  copyExpandedCode() {
    const item = this.data.scanList[this.data.expandedIndex];
    if (item) scanUtils.copyText(item.code, '');
  },

  copyExpandedUrl() {
    const item = this.data.scanList[this.data.expandedIndex];
    if (!item || !item.isUrl) return;
    scanUtils.copyText(item.code, '链接已复制，请到浏览器打开');
  },

  /* ========== 导航 ========== */

  goBack() {
    this._aborted = true;
    wx.navigateBack({ delta: 1 });
  },

  // 仅时刻（HH:mm:ss），用于连续扫码列表的时间列
  formatClockTime(date) {
    const h = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${h}:${mi}:${s}`;
  }
});
