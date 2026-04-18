const app = getApp();

Page({
  data: {
    settings: {},
    historyLimits: [50, 100, 200, 500]
  },

  onLoad() {
    this.setData({
      settings: app.globalData.settings
    });
  },

  toggleSound(e) {
    const settings = { ...this.data.settings, soundEnabled: e.detail.value };
    this.setData({ settings });
    app.saveSettings(settings);
  },

  toggleVibration(e) {
    const settings = { ...this.data.settings, vibrationEnabled: e.detail.value };
    this.setData({ settings });
    app.saveSettings(settings);
  },

  toggleAutoCopy(e) {
    const settings = { ...this.data.settings, autoCopy: e.detail.value };
    this.setData({ settings });
    app.saveSettings(settings);
  },

  changeHistoryLimit(e) {
    const limit = this.data.historyLimits[e.detail.value];
    const settings = { ...this.data.settings, historyLimit: limit };
    this.setData({ settings });
    app.saveSettings(settings);
  }
});