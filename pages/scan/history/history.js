const app = getApp();
const barcode = require('../../../utils/barcode.js');
const permission = require('../../../utils/permission.js');
const scanUtils = require('../utils/scan-utils.js');

// 首屏渲染条数：历史最多保留 365 天，一次性渲染全部会明显卡顿
const PAGE_SIZE = 30

Page({
  data: {
    historyList: [],      // 全量（已排序），供排序与导出使用
    visibleList: [],      // 当前渲染的切片
    visibleCount: PAGE_SIZE,
    hasMore: false,
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
    try {
      const raw = app.globalData.scanHistory || []
      const historyList = raw.map(item => ({
        ...item,
        typeLabel: scanUtils.getTypeLabel(item.type)
      }))
      // 最后保存时间：取记录中最大的时间戳（timestamp 优先，缺失时回退解析 time）
      let latestTs = 0
      for (const item of raw) {
        const ts = scanUtils.getRecordTs(item)
        if (ts > latestTs) latestTs = ts
      }
      // 先排序再一次性 setData，避免「渲染 → 回调排序 → 再渲染」的双次渲染
      const sorted = this.sortList(historyList)
      this.setData({
        historyList: sorted,
        visibleList: sorted.slice(0, PAGE_SIZE),
        visibleCount: PAGE_SIZE,
        hasMore: sorted.length > PAGE_SIZE,
        lastSaveTime: latestTs ? scanUtils.formatRelativeTime(latestTs) : ''
      })
    } catch (e) {
      console.error('[历史] 加载失败', e)
      this.setData({
        historyList: [],
        visibleList: [],
        visibleCount: PAGE_SIZE,
        hasMore: false,
        lastSaveTime: ''
      })
    }
  },

  // 触底加载更多（每次追加一页，不重新渲染已展示项）
  onReachBottom() {
    if (!this.data.hasMore) return
    const total = this.data.historyList.length
    const nextCount = Math.min(this.data.visibleCount + PAGE_SIZE, total)
    this.setData({
      visibleList: this.data.historyList.slice(0, nextCount),
      visibleCount: nextCount,
      hasMore: nextCount < total
    })
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

  // 应用排序到列表（重新排序后回到首屏，避免一次性渲染全部）
  applySort() {
    const sorted = this.sortList(this.data.historyList)
    this.setData({
      historyList: sorted,
      visibleList: sorted.slice(0, PAGE_SIZE),
      visibleCount: PAGE_SIZE,
      hasMore: sorted.length > PAGE_SIZE
    })
  },

  // 按当前排序规则返回新数组（不改动入参）
  sortList(source) {
    const { sortBy, sortAsc } = this.data
    const list = [...source]
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
    return list
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
    const code = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.code) || '';
    const history = app.globalData.scanHistory || [];
    const record = history.find(item => item.code === code);
    const customRuleResults = app.decodeWithRule ? app.decodeWithRule(code) : [];

    let decoded;
    try {
      // decodeBarcode 内部已完成类型识别，直接使用结果，避免重复匹配
      decoded = barcode.decodeBarcode(code, record ? record.wxScanType : '');
    } catch (err) {
      console.error('[历史] 解码失败', err);
      decoded = scanUtils.fallbackDecoded(code);
    }
    scanUtils.mergeCustomRuleResults(decoded, customRuleResults);

    const scanData = {
      code,
      codeHead: code.slice(0, 3),
      type: decoded.type,
      time: record ? record.time : scanUtils.formatDateTime(new Date()),
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
    scanUtils.copyText(this.data.scanResult.code, '已复制');
  },

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

  callPhone() {
    const phone = String(this.data.scanResult.code || '').replace(/^tel:/i, '');
    if (!phone) return;
    wx.makePhoneCall({
      phoneNumber: phone,
      fail: () => { wx.showToast({ title: '拨号失败', icon: 'none' }); }
    });
  },

  sendEmail() {
    const email = String(this.data.scanResult.code || '').replace(/^mailto:/i, '');
    scanUtils.copyText(email, '邮箱已复制');
  },

  goToScan() {
    wx.navigateTo({
      url: '/pages/scan/scan'
    });
  },

  goToRecycleBin() {
    wx.navigateTo({
      url: '/pages/scan/recycleBin/recycleBin'
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
  }
});