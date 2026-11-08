const app = getApp();
const barcode = require('../../utils/barcode.js');
const permission = require('../../utils/permission.js');

Page({
  data: {
    historyList: [],
    showDetail: false,
    scanResult: {},
    decodedInfo: {},
    sortBy: 'time',    // 排序字段: time / type / code
    sortAsc: false,   // 升序/降序
    lastSaveTime: '',  // 最后保存时间
    retentionDays: 3,  // 保留天数
    retentionDesc: '普通用户' // 保留天数描述
  },

  onShow() {
    this.loadHistory();
    this.loadRetentionInfo();
  },

  loadHistory() {
    const raw = app.globalData.scanHistory || []
    const historyList = raw.map(item => ({
      ...item,
      typeLabel: this.getTypeLabel(item.type)
    }))
    // 取最新一条的保存时间作为最后保存时间（优先用 timestamp）
    let lastSaveTime = ''
    if (historyList.length > 0) {
      let latest = 0
      let latestTimeStr = ''
      for (const item of raw) {
        if (item.timestamp && item.timestamp > latest) {
          latest = item.timestamp
        }
        if (item.time && item.time > latestTimeStr) {
          latestTimeStr = item.time
        }
      }
      lastSaveTime = this.formatLastSaveTime(latest > 0 ? latest : latestTimeStr)
    }
    this.setData({ historyList, lastSaveTime }, () => this.applySort())
  },

  // 切换排序方式
  switchSort(e) {
    const field = e.currentTarget.dataset.sort
    if (this.data.sortBy === field) {
      // 同一字段，切换升降序
      this.setData({ sortAsc: !this.data.sortAsc }, () => this.applySort())
    } else {
      // 换字段，默认降序（最新在上）
      const asc = field !== 'time'
      this.setData({ sortBy: field, sortAsc: asc }, () => this.applySort())
    }
  },

  // 应用排序到列表
  applySort() {
    const { sortBy, sortAsc } = this.data
    const list = [...this.data.historyList]
    list.sort((a, b) => {
      let valA, valB
      switch (sortBy) {
        case 'time':
          valA = a.time || ''
          valB = b.time || ''
          break
        case 'type':
          valA = (a.typeLabel || '').toUpperCase()
          valB = (b.typeLabel || '').toUpperCase()
          return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA)
        case 'code':
          valA = a.code || ''
          valB = b.code || ''
          return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA)
        default:
          return 0
      }
      const cmp = valA < valB ? -1 : (valA > valB ? 1 : 0)
      return sortAsc ? cmp : -cmp
    })
    this.setData({ historyList: list })
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
      content: '清空后的数据将保存到云端回收站，可随时恢复。确定要清空所有扫描历史吗？',
      success: (res) => {
        if (res.confirm) {
          // 先上云存档到回收站
          this.recycleBeforeClear().then(() => {
            app.clearScanHistory();
            this.loadHistory();
            wx.showToast({ title: '已清空，数据已存至回收站', icon: 'none', duration: 2000 });
          }).catch(() => {
            // 回收站上传失败也清本地
            app.clearScanHistory();
            this.loadHistory();
            wx.showToast({ title: '本地已清空，云端存档失败', icon: 'none' });
          });
        }
      }
    });
  },

  // 清空前将数据上传到回收站
  async recycleBeforeClear() {
    const history = app.globalData.scanHistory || [];
    if (history.length === 0) return;

    try {
      const records = history.map(item => ({
        code: item.code,
        type: item.type || '',
        time: item.time || '',
        count: item.count || 1,
        wxScanType: item.wxScanType || ''
      }));

      const res = await wx.cloud.callFunction({
        name: 'syncScanHistory',
        data: { action: 'recycle', records }
      });
      return res.result;
    } catch (e) {
      return { success: false, error: e.message || '回收请求异常' };
    }
  },



  viewDetail(e) {
    const code = e.currentTarget.dataset.code;
    const history = app.globalData.scanHistory || [];
    const record = history.find(item => item.code === code);
    const customRuleResults = app.decodeWithRule ? app.decodeWithRule(code) : [];

    const type = barcode.identifyBarcodeType(code, record ? record.wxScanType : '');
    const decoded = barcode.decodeBarcode(code, record ? record.wxScanType : '');

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
      count: record ? record.count : 1,
      wxScanType: record ? record.wxScanType : ''
    };

    this.setData({
      showDetail: true,
      scanResult: scanData,
      decodedInfo: decoded
    });
  },

  closeDetail() {
    this.setData({ showDetail: false });
  },

  copyResult() {
    wx.setClipboardData({
      data: this.data.scanResult.code,
      success: () => { wx.showToast({ title: '已复制', icon: 'success' }); },
      fail: () => { wx.showToast({ title: '复制失败', icon: 'none' }); }
    });
  },

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

  openUrl() {
    const url = this.data.scanResult.code;
    if (!/^https?:\/\//i.test(url)) return;
    wx.navigateTo({
      url: `/package1/pages/browser/browser?url=${encodeURIComponent(url)}`
    });
  },

  callPhone() {
    const phone = this.data.scanResult.code.replace(/^tel:/i, '');
    wx.makePhoneCall({
      phoneNumber: phone,
      fail: () => { wx.showToast({ title: '拨号失败', icon: 'none' }); }
    });
  },

  sendEmail() {
    const email = this.data.scanResult.code.replace(/^mailto:/i, '');
    wx.setClipboardData({
      data: email,
      success: () => { wx.showToast({ title: '邮箱已复制', icon: 'success' }); },
      fail: () => { wx.showToast({ title: '复制失败', icon: 'none' }); }
    });
  },

  goToScan() {
    wx.navigateTo({
      url: '/pages/scan/scan'
    });
  },

  goToRecycleBin() {
    wx.navigateTo({
      url: '/pages/recycleBin/recycleBin'
    });
  },

  loadRetentionInfo() {
    const data = permission.getData()
    const days = data.historyRetentionDays || 3
    let desc = '普通用户'
    if (data.role === 'admin') {
      desc = '管理员'
    } else if (data.role === 'vip' && data.vipExpiresAt && new Date(data.vipExpiresAt) > new Date()) {
      desc = 'VIP'
    }
    this.setData({ retentionDays: days, retentionDesc: desc })
  },

  formatTime(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${d} ${h}:${mi}:${s}`;
  },

  // 手动解析 yyyy-MM-dd HH:mm:ss 为本地时间（避免跨环境 Date 解析差异）
  parseLocalTime(timeStr) {
    if (!timeStr) return null
    const parts = timeStr.split(' ')
    if (parts.length < 2) return null
    const [y, m, d] = parts[0].split('-').map(Number)
    const [h, mi, s] = parts[1].split(':').map(Number)
    if ([y, m, d, h, mi, s].some(v => isNaN(v))) return null
    return new Date(y, m - 1, d, h, mi, s || 0)
  },

  // 格式化最后保存时间为相对时间
  formatLastSaveTime(timestampOrStr) {
    if (timestampOrStr == null) return ''
    let t
    if (typeof timestampOrStr === 'number' && timestampOrStr > 0) {
      t = new Date(timestampOrStr)
    } else {
      t = this.parseLocalTime(String(timestampOrStr))
    }
    if (!t || isNaN(t.getTime())) return ''
    const now = Date.now()
    const diff = now - t.getTime()
    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
    if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前'
    if (diff < 172800000) return '昨天'
    const m = String(t.getMonth() + 1).padStart(2, '0')
    const d = String(t.getDate()).padStart(2, '0')
    return `${m}-${d}`
  }
});