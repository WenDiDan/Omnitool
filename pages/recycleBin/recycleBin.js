Page({
  data: {
    recycledList: [],
    loading: true,
    isEmpty: false,
    retentionDays: 0,
    retentionDaysText: '',
    isAdmin: false
  },

  onShow() {
    this.loadRecycled();
    this.checkAdmin();
  },

  async checkAdmin() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'userManage',
        data: { action: 'getInfo' }
      });
      if (res.result.success && res.result.user) {
        this.setData({ isAdmin: res.result.user.role === 'admin' });
        console.log('[回收站] 当前角色:', res.result.user.role);
      }
    } catch (e) { console.error('[回收站] 检查管理员失败', e); }
  },

  async loadRecycled(debugDays) {
    this.setData({ loading: true });
    try {
      const callData = { action: 'getRecycled' };
      if (debugDays !== undefined) {
        callData.debugDays = debugDays;
        console.log(`[回收站] 调试模式：debugDays=${debugDays}`);
      }
      const res = await wx.cloud.callFunction({
        name: 'syncScanHistory',
        data: callData
      });
      console.log('[回收站] 云函数返回：', JSON.stringify(res.result));
      if (res.result.success) {
        const records = (res.result.records || []).map(r => ({
          ...r,
          typeLabel: this.getTypeLabel(r.type),
          recycledAtDisplay: this.formatRecycledTime(r.recycledAt || r.time)
        }));
        const days = res.result.retentionDays || 0
        this.setData({
          recycledList: records,
          isEmpty: records.length === 0,
          loading: false,
          retentionDays: days,
          retentionDaysText: days >= 365 ? Math.round(days / 365) + '年' : days + '天'
        });

        // 若有超期记录被自动清理，提示用户
        const expiredCleaned = res.result.expiredCleaned || 0;
        if (expiredCleaned > 0) {
          console.log(`[回收站] 自动清理了 ${expiredCleaned} 条过期记录`);
          wx.showToast({ title: `已自动清理 ${expiredCleaned} 条过期记录`, icon: 'none', duration: 2500 });
        }
      } else {
        console.error('[回收站] 加载失败：', res.result.error);
        this.setData({ loading: false, isEmpty: true });
        wx.showToast({ title: res.result.error || '加载失败', icon: 'none', duration: 3000 });
      }
    } catch (e) {
      console.error('[回收站] 调用异常：', e);
      this.setData({ loading: false, isEmpty: true });
      wx.showToast({ title: '调用失败：' + (e.message || e.errMsg || '未知'), icon: 'none', duration: 3000 });
    }
  },

  getTypeLabel(type) {
    const t = (type || '').toLowerCase();
    if (t.includes('ean') || t.includes('isbn') || t.includes('upc') || t.includes('条形码')) return 'EAN';
    if (t.includes('qr') || t.includes('二维码')) return 'QR';
    if (t.includes('url') || t.includes('http')) return 'URL';
    if (t.includes('wifi')) return 'WiFi';
    if (t.includes('vcard') || t.includes('联系人')) return 'Card';
    if (t.includes('tel') || t.includes('电话')) return 'TEL';
    return (type || '?').slice(0, 3).toUpperCase();
  },

  formatRecycledTime(timeStr) {
    if (!timeStr) return '';
    // 计算相对时间
    const parts = timeStr.split(' ');
    if (parts.length < 2) {
      // ISO 格式
      try {
        const d = new Date(timeStr);
        const now = Date.now();
        const diff = now - d.getTime();
        if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
        if (diff < 172800000) return '昨天';
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return m + '-' + day;
      } catch (e) { return timeStr.slice(0, 10); }
    }
    const [y, m, d] = parts[0].split('-').map(Number);
    const [h, mi] = parts[1].split(':').map(Number);
    if (isNaN(y)) return timeStr.slice(0, 10);
    const t = new Date(y, m - 1, d, h, mi, 0);
    if (isNaN(t.getTime())) return timeStr.slice(0, 10);
    const now = Date.now();
    const diff = now - t.getTime();
    if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
    if (diff < 172800000) return '昨天';
    return String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  },

  // 恢复单条记录
  async restoreRecord(e) {
    const code = e.currentTarget.dataset.code;
    wx.showLoading({ title: '恢复中...' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'syncScanHistory',
        data: { action: 'restoreRecycled', code }
      });
      wx.hideLoading();
      if (res.result.success) {
        // 恢复到本地历史
        const app = getApp();
        const record = res.result.record || {};
        if (record.code) {
          const localList = app.globalData.scanHistory || [];
          const existIdx = localList.findIndex(r => r.code === record.code);
          const restoredItem = {
            code: record.code,
            type: record.type || '',
            time: record.time || '',
            count: record.count || 1,
            wxScanType: record.wxScanType || '',
            timestamp: Date.now()
          };
          if (existIdx >= 0) {
            // 已有则更新
            localList[existIdx] = { ...localList[existIdx], ...restoredItem };
          } else {
            // 不存在则添加到最前面
            localList.unshift(restoredItem);
          }
          app.globalData.scanHistory = localList;
          wx.setStorageSync('scanHistory', localList);
        }

        wx.showToast({ title: '已恢复到扫描历史', icon: 'success', duration: 1500 });
        this._restoreTimer = setTimeout(() => this.loadRecycled(), 1200);
      } else {
        wx.showToast({ title: res.result.error || '恢复失败', icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '恢复失败', icon: 'none' });
    }
  },

  // 永久删除单条
  async deleteRecord(e) {
    const code = e.currentTarget.dataset.code;
    wx.showModal({
      title: '确认删除',
      content: '永久删除后将无法恢复，确定吗？',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' });
          try {
            const result = await wx.cloud.callFunction({
              name: 'syncScanHistory',
              data: { action: 'deleteRecycled', code }
            });
            wx.hideLoading();
            if (result.result.success) {
              wx.showToast({ title: '已删除', icon: 'success' });
              this.loadRecycled();
            } else {
              wx.showToast({ title: result.result.error || '删除失败', icon: 'none' });
            }
          } catch (e) {
            wx.hideLoading();
            wx.showToast({ title: '删除失败', icon: 'none' });
          }
        }
      }
    });
  },

  // 清空回收站
  clearAll() {
    wx.showModal({
      title: '清空回收站',
      content: '将永久删除回收站中所有记录，不可恢复。确定清空吗？',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '清空中...' });
          try {
            const result = await wx.cloud.callFunction({
              name: 'syncScanHistory',
              data: { action: 'clearRecycled' }
            });
            wx.hideLoading();
            if (result.result.success) {
              wx.showToast({ title: '回收站已清空', icon: 'success' });
              this.loadRecycled();
            } else {
              wx.showToast({ title: result.result.error || '清空失败', icon: 'none' });
            }
          } catch (e) {
            wx.hideLoading();
            wx.showToast({ title: '清空失败', icon: 'none' });
          }
        }
      }
    });
  },

  // 全部恢复
  async restoreAll() {
    wx.showModal({
      title: '全部恢复',
      content: `将回收站中全部 ${this.data.recycledList.length} 条记录恢复到扫描历史，确定吗？`,
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '恢复中...' });
        try {
          const result = await wx.cloud.callFunction({
            name: 'syncScanHistory',
            data: { action: 'restoreAllRecycled' }
          });
          wx.hideLoading();
          if (result.result.success) {
            const restored = result.result.restored || 0;
            // 恢复到本地历史
            const app = getApp();
            const records = result.result.records || [];
            const localList = app.globalData.scanHistory || [];
            for (const record of records) {
              if (!record.code) continue;
              const existIdx = localList.findIndex(r => r.code === record.code);
              const item = { code: record.code, type: record.type || '', time: record.time || '', count: record.count || 1, wxScanType: record.wxScanType || '', timestamp: Date.now() };
              if (existIdx >= 0) localList[existIdx] = { ...localList[existIdx], ...item };
              else localList.unshift(item);
            }
            app.globalData.scanHistory = localList;
            wx.setStorageSync('scanHistory', localList);

            wx.showToast({ title: `已恢复 ${restored} 条`, icon: 'success', duration: 2000 });
            this._restoreAllTimer = setTimeout(() => this.loadRecycled(), 1500);
          } else {
            wx.showToast({ title: result.result.error || '恢复失败', icon: 'none' });
          }
        } catch (e) {
          wx.hideLoading();
          wx.showToast({ title: '恢复失败', icon: 'none' });
        }
      }
    });
  },

  goBack() {
    wx.navigateBack();
  },

  onUnload() {
    if (this._restoreTimer) clearTimeout(this._restoreTimer);
    if (this._restoreAllTimer) clearTimeout(this._restoreAllTimer);
    if (this._clearTimer) clearTimeout(this._clearTimer);
  },

  // 调试：生成 20 条测试数据（10条4天前 + 10条1天前）
  async insertTestData() {
    wx.showModal({
      title: '生成测试数据',
      content: '将生成 20 条测试记录插入回收站（10条4天前 + 10条1天前），用于验证过期清理功能。确定？',
      confirmText: '确定',
      cancelText: '取消',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '插入中...' });
        try {
          const result = await wx.cloud.callFunction({
            name: 'syncScanHistory',
            data: { action: 'insertTestData' }
          });
          wx.hideLoading();
          if (result.result.success) {
            wx.showToast({ title: result.result.message || `已生成 ${result.result.inserted} 条`, icon: 'success', duration: 2000 });
            setTimeout(() => this.loadRecycled(), 1500);
          } else {
            wx.showToast({ title: result.result.error || '插入失败', icon: 'none' });
          }
        } catch (e) {
          wx.hideLoading();
          wx.showToast({ title: '调用失败', icon: 'none' });
        }
      }
    });
  },

  // 调试：长按标题 → 选择模拟保留天数来测试过期清理
  debugExpire() {
    if (this.data.recycledList.length === 0) {
      wx.showToast({ title: '回收站为空，无需测试', icon: 'none' });
      return;
    }
    wx.showActionSheet({
      itemList: ['保留 ≤1天（删 >1天前）', '保留 ≤3天（删 >3天前）', '保留 ≤7天（删 >7天前）', '全部过期（debugDays=0）'],
      success: (res) => {
        const debugValues = [1, 3, 7, 0];
        const debugDays = debugValues[res.tapIndex];
        const label = ['保留≤1天', '保留≤3天', '保留≤7天', '全部过期'][res.tapIndex];
        wx.showModal({
          title: `调试：${label}`,
          content: `用 debugDays=${debugDays} 模拟过期清理，当前共 ${this.data.recycledList.length} 条记录将被按规则过滤。确定执行？`,
          confirmText: '确定清理',
          cancelText: '取消',
          success: (modalRes) => {
            if (modalRes.confirm) {
              this.loadRecycled(debugDays);
            }
          }
        });
      }
    });
  }
});
