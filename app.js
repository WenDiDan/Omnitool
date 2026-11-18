const permission = require('./utils/permission.js')
const historyStore = require('./utils/history-store.js')
const settingsStore = require('./utils/settings-store.js')
const ruleService = require('./utils/rule-service.js')
const userSession = require('./utils/user-session.js')

App({
  globalData: {
    userInfo: null,
    scanHistory: [],
    scanHistoryVersion: 0, // 历史数据版本号：任何增删改都自增，供统计面板做增量判断
    historyRetentionDays: 3, // 历史保留天数，普通用户3天，VIP/管理员365天
    settings: {
      soundEnabled: true,
      vibrationEnabled: true,
      autoCopy: false,
      historyLimit: 100
    },
    customRules: [],  // 自定义解码规则
    isFirstShow: true,  // 小程序启动后首次进入页面标记
    _autoLoginPromise: null  // autoLogin 的 Promise，供页面判断是否正在登录中
  },
  
    onLaunch() {
      if (wx.cloud) {
        wx.cloud.init({
          env: 'wendi-d5gnswjf75b25aac0',
          traceUser: true
        });
      }
      this.initStorage();
      this.checkUpdate();
      const autoLoginPromise = this.autoLogin().catch(() => {});
      this.globalData._autoLoginPromise = autoLoginPromise;  // 供页面判断是否正在登录中
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

        const customRules = wx.getStorageSync('customRules');
        if (customRules) {
          this.globalData.customRules = customRules;
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
  
    // ===== 存储代理：真实实现位于 utils/*-store.js =====
    saveScanHistory(scanData) {
      return historyStore.saveScanHistory(this.globalData, scanData);
    },

    clearScanHistory() {
      return historyStore.clearScanHistory(this.globalData);
    },
 
    saveSettings(settings) {
      return settingsStore.saveSettings(this.globalData, settings);
    },

    // ===== 解码规则代理：真实实现位于 utils/rule-service.js =====
    getCustomRules() {
      return ruleService.getCustomRules(this.globalData);
    },

    addCustomRule(rule) {
      return ruleService.addCustomRule(this.globalData, rule);
    },

    deleteCustomRule(id) {
      return ruleService.deleteCustomRule(this.globalData, id);
    },

    updateCustomRule(id, updates) {
      return ruleService.updateCustomRule(this.globalData, id, updates);
    },

    // 日期代码映射表（只读视图；真实状态由 utils/decode-rules.js 维护）
    get DATE_CODE_MAPS() {
      return ruleService.getDateCodeMaps();
    },

    // 更新自定义日期映射
    updateDateMapping(customMapping) {
      return ruleService.updateDateMapping(customMapping);
    },

    // 字母/数字 → 日期数值
    convertLetterToDate(char) {
      return ruleService.convertLetterToDate(char);
    },

    // 根据启用中的规则解码扫码内容
    decodeWithRule(code) {
      return ruleService.decodeWithRule(this.globalData, code);
    },

    /**
     * 自动登录：小程序启动时同步一次云端身份
     *
     * 权限缓存统一由 utils/permission.js 写入（本方法不再直接写缓存），
     * 避免 autoLogin 与页面 onShow 的 syncFromCloud 并发写入旧值。
     */
    async autoLogin() {
      console.log('[app] 自动登录中...')
      try {
        const user = await permission.syncFromCloud()
        if (user && user.openid) {
          const loginTime = userSession.nowText()
          // 应用用户信息到全局与兼容 Storage
          this.applyUserInfo(user)
          wx.setStorageSync('isLoggedIn', true)
          wx.setStorageSync('loginTime', loginTime)
          wx.setStorageSync('lastActiveTime', loginTime)
          console.log('[app] 自动登录成功:', user.role, user.nickName || '无昵称')
        } else {
          console.warn('[app] 自动登录未获取到用户身份')
        }
      } catch (e) {
        // syncFromCloud 内部已做兜底，这里只记录异常
        console.error('[app] 自动登录异常', e)
      } finally {
        this.globalData._autoLoginPromise = null
      }
    },

    /**
     * 将用户信息应用到 globalData 和旧版 storage（向后兼容）
     * 实现位于 utils/user-session.js，本方法仅做依赖注入
     */
    applyUserInfo(user) {
      return userSession.applyUserInfo(this.globalData, user, (url) => this.getAvatarUrl(url))
    },

    /**
     * 登出时清除权限缓存
     */
    clearUserPermission() {
      return userSession.clearUserPermission(this.globalData)
    },

    // 获取头像URL（cloud:// 转 https://）
    async getAvatarUrl(avatarUrl) {
      if (!avatarUrl) return '/images/nav_user_white.png'
      if (avatarUrl.startsWith('https://')) return avatarUrl
      if (avatarUrl.startsWith('http://thirdwx.qlogo.cn') || avatarUrl.startsWith('http://wx.qlogo.cn')) {
        return avatarUrl.replace('http://', 'https://')
      }
      if (avatarUrl.startsWith('cloud://')) {
        try {
          const res = await wx.cloud.getTempFileURL({
            fileList: [{ fileID: avatarUrl, maxAge: 0 }]
          })
          if (res.fileList && res.fileList[0] && res.fileList[0].tempFileURL) {
            return res.fileList[0].tempFileURL + '?t=' + Date.now()
          }
        } catch (e) {
          console.error('获取云存储头像失败', e)
        }
        return '/images/nav_user_white.png'
      }
      return avatarUrl || '/images/nav_user_white.png'
    }
  });