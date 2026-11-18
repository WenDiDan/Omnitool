Page({
  data: {
    activeTab: 'scan'
  },

  onLoad(options) {
    // 外部入口：?tab=decode|settings 直达对应页签；?code=xxx 直接触发扫码结果处理
    if (options && ['decode', 'settings'].includes(options.tab)) {
      this.setData({ activeTab: options.tab });
    }
    if (options && options.code) {
      const panel = this.selectComponent('#scanPanel');
      if (panel && panel.handleScanResult) {
        panel.handleScanResult(options.code);
      }
    }
  },

  onTabTap(e) {
    const tab = e.currentTarget.dataset.tab;
    if (!tab || tab === this.data.activeTab) return;
    this.setData({ activeTab: tab });
    // 设置页签为纯入口页，无需触发面板 onShow
    if (tab === 'settings') return;
    // 切换时触发对应面板的 onShow（刷新统计 / 最近记录）
    const panel = this.selectComponent(tab === 'scan' ? '#scanPanel' : '#decodePanel');
    if (panel && panel.onShow) panel.onShow();
  },

  // 扫码设置（提示音 / 震动 / 自动复制 / 解码规则）
  goToSettings() {
    wx.navigateTo({ url: '/pages/scan/settings/settings' });
  },

  // 回收站（已清空的扫码记录可恢复或彻底删除）
  goToRecycleBin() {
    wx.navigateTo({ url: '/pages/scan/recycleBin/recycleBin' });
  }
});
