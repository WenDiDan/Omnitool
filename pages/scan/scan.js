Page({
  data: {
    activeTab: 'scan'
  },

  onLoad(options) {
    // 外部入口：?tab=decode 直达解码；?code=xxx 直接触发扫码结果处理
    if (options && options.tab === 'decode') {
      this.setData({ activeTab: 'decode' });
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
    // 切换时触发对应面板的 onShow（刷新统计 / 最近记录）
    const panel = this.selectComponent(tab === 'scan' ? '#scanPanel' : '#decodePanel');
    if (panel && panel.onShow) panel.onShow();
  }
});
