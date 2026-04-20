App({
    globalData: {
      userInfo: null,
      scanHistory: [],
      settings: {
        soundEnabled: true,
        vibrationEnabled: true,
        autoCopy: false,
        historyLimit: 100
      }
    },
  
    onLaunch() {
      if (wx.cloud) {
        wx.cloud.init({
          traceUser: true
        });
      }
      this.initStorage();
      this.checkUpdate();
    },
  
    initStorage() {
      try {
        const history = wx.getStorageSync('scanHistory');
        if (history) {
          this.globalData.scanHistory = history;
        }
  
        const settings = wx.getStorageSync('settings');
        if (settings) {
          this.globalData.settings = { ...this.globalData.settings, ...settings };
        }
      } catch (e) {
        console.error('初始化存储失败', e);
      }
    },
  
    checkUpdate() {
      const updateManager = wx.getUpdateManager();
      updateManager.onCheckForUpdate((res) => {
        if (res.hasUpdate) {
          updateManager.onUpdateReady(() => {
            wx.showModal({
              title: '更新提示',
              content: '新版本已准备好，是否重启应用？',
              success: (res) => {
                if (res.confirm) {
                  updateManager.applyUpdate();
                }
              }
            });
          });
        }
      });
    },
  
    saveScanHistory(scanData) {
      const history = this.globalData.scanHistory;
      const maxLimit = this.globalData.settings.historyLimit;
      
      // 移除重复项
      const existingIndex = history.findIndex(item => item.code === scanData.code);
      if (existingIndex !== -1) {
        history.splice(existingIndex, 1);
      }
      
      // 添加新记录到开头
      history.unshift({
        ...scanData,
        timestamp: Date.now()
      });
      
      // 限制历史记录数量
      if (history.length > maxLimit) {
        history.length = maxLimit;
      }
      
      this.globalData.scanHistory = history;
      wx.setStorageSync('scanHistory', history);
    },
  
    clearScanHistory() {
      this.globalData.scanHistory = [];
      wx.setStorageSync('scanHistory', []);
    },
  
    saveSettings(settings) {
      this.globalData.settings = { ...this.globalData.settings, ...settings };
      wx.setStorageSync('settings', this.globalData.settings);
    }
  });