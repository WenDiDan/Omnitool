const permission = require('./utils/permission.js')

App({
  globalData: {
    userInfo: null,
    scanHistory: [],
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
  
    saveScanHistory(scanData) {
      const history = this.globalData.scanHistory;
      const maxLimit = this.globalData.settings.historyLimit;
      const count = scanData.count || 1;
      const decodedInfo = scanData.decodedInfo;
      
      // 检查是否已存在，累加次数
      const existingIndex = history.findIndex(item => item.code === scanData.code);
      if (existingIndex !== -1) {
        history[existingIndex].count = count;
        history[existingIndex].time = scanData.time;
        history[existingIndex].timestamp = Date.now();  // 更新时间戳
        history[existingIndex].wxScanType = scanData.wxScanType;
        history[existingIndex].decodedInfo = decodedInfo;
        // 移到开头
        const item = history.splice(existingIndex, 1)[0];
        history.unshift(item);
      } else {
        // 新记录
        history.unshift({
          ...scanData,
          count: count,
          timestamp: Date.now()
        });
      }
      
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
    },

    // 自定义解码规则
    getCustomRules() {
      return this.globalData.customRules || [];
    },

    addCustomRule(rule) {
      const rules = this.globalData.customRules || [];
      rules.unshift({
        ...rule,
        id: Date.now().toString(),
        createdAt: new Date().toLocaleString()
      });
      this.globalData.customRules = rules;
      wx.setStorageSync('customRules', rules);
      return rules;
    },

    deleteCustomRule(id) {
      const rules = this.globalData.customRules || [];
      this.globalData.customRules = rules.filter(r => r.id !== id);
      wx.setStorageSync('customRules', this.globalData.customRules);
      return this.globalData.customRules;
    },

    updateCustomRule(id, updates) {
      const rules = this.globalData.customRules || [];
      const index = rules.findIndex(r => r.id === id);
      if (index !== -1) {
        rules[index] = { ...rules[index], ...updates };
        this.globalData.customRules = rules;
        wx.setStorageSync('customRules', rules);
      }
      return rules;
    },

    // 日期代码映射表
    DATE_CODE_MAPS: {
      // 字母转年份偏移 (基准年2020)
      letterToYear: {
        'A': 0, 'B': 1, 'C': 2, 'D': 3, 'E': 4, 'F': 5, 'G': 6, 'H': 7,
        'J': 8, 'K': 9, 'L': 10, 'M': 11, 'N': 12, 'P': 13, 'R': 14, 'S': 15,
        'T': 16, 'U': 17, 'V': 18, 'W': 19, 'X': 20, 'Y': 21, 'Z': 22
      },
      // 字母转月份 (数字1-9显示为01-09，字母A=10, B=11, C=12)
      letterToMonth: {
        'A': 10, 'B': 11, 'C': 12
      },
      // 数字转月份（直接返回，会在显示时格式化为两位数）
      numberToMonth: {},
      // 字母转日期 (数字1-9显示为01-09，字母A=10, B=11...)
      letterToDay: {
        'A': 10, 'B': 11, 'C': 12, 'D': 13, 'E': 14, 'F': 15, 'G': 16, 'H': 17,
        'J': 18, 'K': 19, 'L': 20, 'M': 21, 'N': 22, 'P': 23, 'R': 24,
        'S': 25, 'T': 26, 'U': 27, 'V': 28, 'W': 29, 'X': 30, 'Y': 31, 'Z': 32
      },
      // 基准年份
      baseYear: 2020
    },

    // 更新自定义日期映射
    updateDateMapping(customMapping) {
      if (customMapping) {
        if (customMapping.baseYear !== undefined) {
          this.DATE_CODE_MAPS.baseYear = customMapping.baseYear;
        }
        if (customMapping.yearLetters) {
          this.DATE_CODE_MAPS.letterToYear = customMapping.yearLetters;
        }
        if (customMapping.monthLetters) {
          this.DATE_CODE_MAPS.letterToMonth = customMapping.monthLetters;
        }
        if (customMapping.dayLetters) {
          this.DATE_CODE_MAPS.letterToDay = customMapping.dayLetters;
        }
      }
    },

    // 转换字母为日期
    convertLetterToDate(char) {
      // 如果是数字，直接返回
      if (/^\d$/.test(char)) {
        return parseInt(char);
      }
      
      const maps = this.DATE_CODE_MAPS;
      const upperChar = char.toUpperCase();
      
      // 年份
      if (maps.letterToYear[upperChar] !== undefined) {
        return maps.baseYear + maps.letterToYear[upperChar];
      }
      // 月份
      if (maps.letterToMonth[upperChar] !== undefined) {
        return maps.letterToMonth[upperChar];
      }
      // 日期
      if (maps.letterToDay[upperChar] !== undefined) {
        return maps.letterToDay[upperChar];
      }
      return char;
    },

    // 根据规则解码扫描内容
    decodeWithRule(code) {
      const rules = this.getCustomRules().filter(r => r.enabled);
      const results = [];
      const codeLength = code.length;

      for (const rule of rules) {
        try {
          // 长度匹配检查
          if (rule.lengthEnabled) {
            const minLen = rule.minLength || 0;
            const maxLen = rule.maxLength || Infinity;
            if (codeLength < minLen || codeLength > maxLen) {
              continue;
            }
          }
          
          // 验证正则表达式有效性
          if (!rule.pattern) continue;
          
          let regex;
          try {
            regex = new RegExp(rule.pattern);
          } catch (e) {
            console.warn('正则表达式无效:', rule.pattern, e.message);
            continue;
          }
          
          if (regex.test(code)) {
            let extracted = code;

            if (rule.extract === '提取位置' && rule.startPos && rule.endPos) {
              const start = rule.startPos - 1;
              const end = rule.endPos;
              extracted = code.substring(start, end);
            } else if (rule.extract === '匹配的全部') {
              extracted = code;
            } else if (rule.extract === '域名') {
              try {
                const url = new URL(code.startsWith('http') ? code : 'http://' + code);
                extracted = url.hostname;
              } catch (e) {
                extracted = code;
              }
            } else if (rule.extract === '@后的域名') {
              const atIndex = code.indexOf('@');
              if (atIndex !== -1) {
                const afterAt = code.substring(atIndex + 1);
                const dotIndex = afterAt.indexOf('.');
                extracted = dotIndex !== -1 ? afterAt.substring(0, dotIndex) : afterAt;
              }
            }

            const resultItem = {
              label: rule.label || rule.name,
              rawValue: extracted,
              value: extracted
            };

            // 日期转换 - 位置基于原始条码
            if (rule.dateMapping && rule.dateMapping.enabled) {
              const mapping = rule.dateMapping;
              const maps = this.DATE_CODE_MAPS;
              let convertedDate = '';
              
              // 年份转换 - 从原始code中取位置
              if (mapping.yearPos && mapping.yearPos > 0 && mapping.yearPos <= code.length) {
                const yearChar = code[mapping.yearPos - 1];
                let year;
                if (/\d/.test(yearChar)) {
                  year = parseInt(yearChar);
                } else {
                  const offset = maps.letterToYear[yearChar.toUpperCase()];
                  year = offset !== undefined ? maps.baseYear + offset : null;
                }
                if (year !== null) {
                  convertedDate = year.toString();
                }
              }
              
              // 月份转换 - 从原始code中取位置
              if (mapping.monthPos && mapping.monthPos > 0 && mapping.monthPos <= code.length) {
                const monthChar = code[mapping.monthPos - 1];
                let month = null;
                if (/\d/.test(monthChar)) {
                  month = parseInt(monthChar);
                } else {
                  const monthVal = maps.letterToMonth[monthChar.toUpperCase()];
                  if (monthVal !== undefined) {
                    month = monthVal;
                  }
                }
                if (month !== null && convertedDate) {
                  convertedDate += '-' + month.toString().padStart(2, '0');
                }
              }
              
              // 日期转换 - 从原始code中取位置
              if (mapping.dayPos && mapping.dayPos > 0 && mapping.dayPos <= code.length) {
                const dayChar = code[mapping.dayPos - 1];
                let day = null;
                if (/\d/.test(dayChar)) {
                  day = parseInt(dayChar);
                } else {
                  const dayVal = maps.letterToDay[dayChar.toUpperCase()];
                  if (dayVal !== undefined) {
                    day = dayVal;
                  }
                }
                if (day !== null && convertedDate && convertedDate.includes('-')) {
                  convertedDate += '-' + day.toString().padStart(2, '0');
                }
              }
              
              if (convertedDate && convertedDate.length >= 4) {
                resultItem.value = convertedDate;
                resultItem.isDate = true;
                resultItem.rawValue = extracted;
              }
            }

            results.push(resultItem);
          }
        } catch (e) {
          console.error('规则匹配错误:', rule.name, e);
        }
      }

      return results;
    },

    /**
     * 自动登录：小程序启动时自动获取用户身份
     */
    async autoLogin() {
      console.log('[app] 自动登录中...')
      try {
        const res = await wx.cloud.callFunction({
          name: 'userManage',
          data: { action: 'getInfo' }
        })
        if (res.result && res.result.success) {
          const user = res.result.user
          const now = new Date()
          const loginTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
          
          // 写入权限缓存
          permission.saveCache(user)
          // 应用用户信息到全局和本地存储
          this.applyUserInfo(user)
          
          // 保存登录状态
          wx.setStorageSync('isLoggedIn', true)
          wx.setStorageSync('loginTime', loginTime)
          wx.setStorageSync('lastActiveTime', loginTime)
          if (user.openid) {
            wx.setStorageSync('userOpenid', user.openid)
          }
          
          console.log('[app] 自动登录成功:', user.role, user.nickName || '无昵称')
        } else {
          console.warn('[app] 自动登录失败:', res.result?.error || '未知错误')
          // 写入空权限缓存，避免页面报错
          permission.saveCache({ openid: '', role: 'user', roleLabel: '普通用户', level: 1, nickName: '', avatarUrl: '', isBlocked: false })
        }
      } catch (e) {
        console.error('[app] 自动登录异常', e)
        permission.saveCache({ openid: '', role: 'user', roleLabel: '普通用户', level: 1, nickName: '', avatarUrl: '', isBlocked: false })
      } finally {
        this.globalData._autoLoginPromise = null
      }
    },

    /**
     * 将用户信息应用到 globalData 和旧版 storage（向后兼容）
     */
    applyUserInfo(user) {
      if (!user || !user.openid) return

      const now = new Date()
      const activeTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

      // 向后兼容：继续写入旧版 storage key
      if (user.nickName) {
        wx.setStorageSync('userNickName', user.nickName)
      }
      if (user.openid) {
        wx.setStorageSync('userOpenid', user.openid)
      }
      wx.setStorageSync('lastActiveTime', activeTime)

      // 头像单独处理（不阻塞主流程）
      if (user.avatarUrl) {
        this.getAvatarUrl(user.avatarUrl).then(url => {
          wx.setStorageSync('userAvatar', url)
        }).catch(() => {})
      }

      this.globalData.userInfo = user
    },

    /**
     * 登出时清除权限缓存
     */
    clearUserPermission() {
      permission.clearCache()
      this.globalData.userInfo = null
      wx.removeStorageSync('userNickName')
      wx.removeStorageSync('userOpenid')
      wx.removeStorageSync('userAvatar')
      wx.removeStorageSync('lastActiveTime')
      wx.removeStorageSync('isLoggedIn')
    },

    // 获取头像URL（cloud:// 转 https://）
    async getAvatarUrl(avatarUrl) {
      if (!avatarUrl) return '/images/icon_user_white.png'
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
        return '/images/icon_user_white.png'
      }
      return avatarUrl || '/images/icon_user_white.png'
    }
  });