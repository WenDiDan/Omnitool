const app = getApp();

Page({
  data: {
    settings: {},
    historyLimits: [50, 100, 200, 500],
    customRules: [],
    isEditing: false,
    editingRule: null,
    formData: {
      name: '',
      pattern: '',
      extract: '匹配的全部',
      label: '',
      startPos: '',
      endPos: '',
      lengthEnabled: false,
      minLength: '',
      maxLength: '',
      dateMapping: {
        enabled: false,
        yearPos: '',
        monthPos: '',
        dayPos: ''
      }
    },
    extractOptions: ['匹配的全部', '域名', '@后的域名', '提取位置'],
    showDateHelper: false,  // 日期对照表展开状态
    // 规则测试
    testInput: '',
    testResult: null,
    testError: null,
    testSteps: [],
    testNoMatch: null,
    // 预设模板
    presets: [
      { name: '顺丰快递', icon: '📦', pattern: 'SF\\d{10,}', extract: '匹配的全部', label: '顺丰单号', desc: 'SF开头+10位数字' },
      { name: '圆通快递', icon: '📮', pattern: 'YT\\d{12,}', extract: '匹配的全部', label: '圆通单号', desc: 'YT开头+12位数字' },
      { name: '韵达快递', icon: '📬', pattern: 'YD\\d{12,}', extract: '匹配的全部', label: '韵达单号', desc: 'YD开头+12位数字' },
      { name: '中通快递', icon: '📭', pattern: 'ZTO\\d{12,}', extract: '匹配的全部', label: '中通单号', desc: 'ZTO开头+12位数字' },
      { name: '京东快递', icon: '🛒', pattern: 'JD[A-Z0-9]{10,}', extract: '匹配的全部', label: '京东单号', desc: 'JD开头+字母数字' },
      { name: 'EMS快递', icon: '✉️', pattern: 'EA\\d{9,}EB', extract: '匹配的全部', label: 'EMS单号', desc: 'EA开头+数字+EB' },
      { name: '极兔快递', icon: '🐰', pattern: 'JTX\\d{12,}', extract: '匹配的全部', label: '极兔单号', desc: 'JTX开头+12位数字' },
      { name: '德邦快递', icon: '🚚', pattern: 'DPK\\d{12,}', extract: '匹配的全部', label: '德邦单号', desc: 'DPK开头+12位数字' },
      { name: '批次号', icon: '🏷️', pattern: 'P\\d{6}', extract: '匹配的全部', label: '批次号', desc: 'P+6位日期数字', dateMapping: { enabled: true, yearPos: 2, monthPos: 3, dayPos: 4 } },
      { name: '生产日期', icon: '📅', pattern: '\\d{8}', extract: '提取位置', label: '生产日期', desc: '8位日期格式', startPos: 1, endPos: 9, dateMapping: { enabled: true, yearPos: 1, monthPos: 5, dayPos: 7 } }
    ],
    // 自定义对照表设置
    customMapping: {
      baseYear: 2020,  // 基准年份
      yearLetters: { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, J: 8, K: 9, L: 10, M: 11, N: 12, P: 13, R: 14, S: 15, T: 16, U: 17, V: 18, W: 19, X: 20, Y: 21, Z: 22 },
      monthLetters: { A: 10, B: 11, C: 12 },  // 数字1-9直接显示为01-09
      dayLetters: { A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, G: 16, H: 17, J: 18, K: 19, L: 20, M: 21, N: 22, P: 23, R: 24, S: 25, T: 26, U: 27, V: 28, W: 29, X: 30, Y: 31, Z: 32 }  // 数字1-9直接显示为01-09
    }
  },

  onLoad() {
    this.setData({
      settings: app.globalData.settings,
      customRules: app.getCustomRules()
    });
  },

  onShow() {
    this.setData({ customRules: app.getCustomRules() });
    // 加载自定义对照表
    this.loadCustomMapping();
  },

    // 加载自定义对照表
    loadCustomMapping() {
      const saved = wx.getStorageSync('customDateMapping');
      if (saved) {
        // 检查并修复旧格式数据
        const fixedMapping = { ...this.data.customMapping, ...saved };
        
        // 修复月份映射（如果旧数据格式不对）
        if (!fixedMapping.monthLetters.A || fixedMapping.monthLetters.A === 1) {
          fixedMapping.monthLetters = { A: 10, B: 11, C: 12 };
        }
        // 修复日期映射（如果旧数据格式不对）
        if (!fixedMapping.dayLetters.A || fixedMapping.dayLetters.A === 1) {
          fixedMapping.dayLetters = { A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, G: 16, H: 17, J: 18, K: 19, L: 20, M: 21, N: 22, P: 23, R: 24, S: 25, T: 26, U: 27, V: 28, W: 29, X: 30, Y: 31, Z: 32 };
        }
        
        this.setData({ customMapping: fixedMapping });
        // 保存修复后的数据
        wx.setStorageSync('customDateMapping', fixedMapping);
        // 同步到 app
        app.updateDateMapping(fixedMapping);
      } else {
        // 没有保存的数据，使用默认值并保存
        const defaultMapping = this.data.customMapping;
        wx.setStorageSync('customDateMapping', defaultMapping);
        app.updateDateMapping(defaultMapping);
      }
    },

  // 切换日期对照表显示
  toggleDateHelper() {
    this.setData({ showDateHelper: !this.data.showDateHelper });
  },

  // 更新基准年份
  onBaseYearInput(e) {
    const val = parseInt(e.detail.value) || 2020;
    const mapping = { ...this.data.customMapping, baseYear: val };
    this.setData({ customMapping: mapping });
    this.saveCustomMapping(mapping);
  },

  // 更新字母映射
  onLetterMappingInput(e) {
    const { type, letter } = e.currentTarget.dataset;
    const value = e.detail.value;
    const mapping = { ...this.data.customMapping };
    mapping[type][letter] = parseInt(value) || 0;
    this.setData({ customMapping: mapping });
    this.saveCustomMapping(mapping);
  },

  // 保存自定义对照表
  saveCustomMapping(mapping) {
    wx.setStorageSync('customDateMapping', mapping);
    app.updateDateMapping(mapping);
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
  },

  // 显示添加表单
  showAddForm() {
    this.setData({
      isEditing: true,
      editingRule: null,
      testInput: '',
      testResult: null,
      testError: null,
      formData: {
        name: '',
        pattern: '',
        extract: '匹配的全部',
        startPos: '',
        endPos: '',
        label: '',
        lengthEnabled: false,
        minLength: '',
        maxLength: '',
        dateMapping: {
          enabled: false,
          yearPos: '',
          monthPos: '',
          dayPos: ''
        }
      }
    });
  },

  // 显示编辑表单
  showEditForm(e) {
    const rule = e.currentTarget.dataset.rule;
    this.setData({
      isEditing: true,
      editingRule: rule,
      testInput: '',
      testResult: null,
      testError: null,
      testSteps: [],
      testNoMatch: null,
      formData: {
        name: rule.name,
        pattern: rule.pattern,
        extract: rule.extract || '匹配的全部',
        startPos: rule.startPos || '',
        endPos: rule.endPos || '',
        label: rule.label,
        lengthEnabled: rule.lengthEnabled || false,
        minLength: rule.minLength || '',
        maxLength: rule.maxLength || '',
        dateMapping: rule.dateMapping || {
          enabled: false,
          yearPos: '',
          monthPos: '',
          dayPos: ''
        }
      }
    });
  },

  // 取消编辑
  cancelEdit() {
    this.setData({ isEditing: false, editingRule: null });
  },

  // 删除当前编辑的规则
  deleteCurrentRule() {
    const { editingRule } = this.data;
    if (!editingRule) return;
    
    wx.showModal({
      title: '确认删除',
      content: `确定删除规则"${editingRule.name}"吗？`,
      success: (res) => {
        if (res.confirm) {
          app.deleteCustomRule(editingRule.id);
          this.setData({ 
            isEditing: false, 
            editingRule: null,
            customRules: app.getCustomRules() 
          });
          wx.showToast({ title: '已删除', icon: 'success' });
        }
      }
    });
  },

  // 表单输入处理
  onFormInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({
      [`formData.${field}`]: e.detail.value
    });
  },

  // 提取方式选择
  onExtractChange(e) {
    const extract = this.data.extractOptions[e.detail.value];
    this.setData({
      'formData.extract': extract
    });
  },

  // 长度匹配开关
  onLengthToggle(e) {
    this.setData({
      'formData.lengthEnabled': e.detail.value
    });
  },

  // 日期映射开关
  onDateMappingToggle(e) {
    this.setData({
      'formData.dateMapping.enabled': e.detail.value
    });
  },

  // 日期映射位置输入
  onDateMappingInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({
      [`formData.dateMapping.${field}`]: e.detail.value
    });
  },

  // 保存规则
  saveRule() {
    const { name, pattern, extract, startPos, endPos, label, lengthEnabled, minLength, maxLength, dateMapping } = this.data.formData;
    
    if (!name.trim()) {
      wx.showToast({ title: '请输入规则名称', icon: 'none' });
      return;
    }
    if (!pattern.trim()) {
      wx.showToast({ title: '请输入正则表达式', icon: 'none' });
      return;
    }
    if (extract === '提取位置' && (!startPos || !endPos)) {
      wx.showToast({ title: '请填写提取位置', icon: 'none' });
      return;
    }
    if (lengthEnabled && !minLength) {
      wx.showToast({ title: '请填写最小长度', icon: 'none' });
      return;
    }
    
    const newRule = {
      name: name.trim(),
      pattern: pattern.trim(),
      extract: extract || '匹配的全部',
      startPos: startPos ? parseInt(startPos) : null,
      endPos: endPos ? parseInt(endPos) : null,
      label: label.trim() || name.trim(),
      enabled: true,
      lengthEnabled: lengthEnabled || false,
      minLength: minLength ? parseInt(minLength) : null,
      maxLength: maxLength ? parseInt(maxLength) : null,
      dateMapping: dateMapping.enabled ? {
        enabled: true,
        yearPos: dateMapping.yearPos ? parseInt(dateMapping.yearPos) : null,
        monthPos: dateMapping.monthPos ? parseInt(dateMapping.monthPos) : null,
        dayPos: dateMapping.dayPos ? parseInt(dateMapping.dayPos) : null
      } : { enabled: false }
    };

    if (this.data.editingRule) {
      app.updateCustomRule(this.data.editingRule.id, newRule);
    } else {
      app.addCustomRule(newRule);
    }

    this.setData({
      isEditing: false,
      editingRule: null,
      customRules: app.getCustomRules()
    });
    wx.showToast({ title: '保存成功', icon: 'success' });
  },

  // 删除规则
  deleteRule(e) {
    const rule = e.currentTarget.dataset.rule;
    wx.showModal({
      title: '确认删除',
      content: `确定删除规则"${rule.name}"吗？`,
      success: (res) => {
        if (res.confirm) {
          app.deleteCustomRule(rule.id);
          this.setData({ customRules: app.getCustomRules() });
          wx.showToast({ title: '已删除', icon: 'success' });
        }
      }
    });
  },

  // 切换规则启用状态
  toggleRule(e) {
    const rule = e.currentTarget.dataset.rule;
    app.updateCustomRule(rule.id, { enabled: !rule.enabled });
    this.setData({ customRules: app.getCustomRules() });
  },

  // 快速添加预设规则
  addPreset(e) {
    const ruleStr = e.currentTarget.dataset.rule;
    const startPos = e.currentTarget.dataset.start;
    const endPos = e.currentTarget.dataset.end;
    const parts = ruleStr.split('|');
    if (parts.length >= 4) {
      const newRule = {
        name: parts[0],
        pattern: parts[1],
        extract: parts[2],
        label: parts[3],
        startPos: startPos ? parseInt(startPos) : null,
        endPos: endPos ? parseInt(endPos) : null,
        enabled: true
      };
      app.addCustomRule(newRule);
      this.setData({ customRules: app.getCustomRules() });
      wx.showToast({ title: '已添加', icon: 'success' });
    }
  },
  
  // 从预设列表选择
  selectPreset(e) {
    const preset = e.currentTarget.dataset.preset;
    this.setData({
      isEditing: true,
      editingRule: null,
      testInput: '',
      testResult: null,
      testError: null,
      formData: {
        name: preset.name,
        pattern: preset.pattern,
        extract: preset.extract || '匹配的全部',
        startPos: preset.startPos || '',
        endPos: preset.endPos || '',
        label: preset.label,
        lengthEnabled: false,
        minLength: '',
        maxLength: '',
        dateMapping: preset.dateMapping || {
          enabled: false,
          yearPos: '',
          monthPos: '',
          dayPos: ''
        }
      }
    });
  },
  
  // 测试规则
  onTestInput(e) {
    this.setData({ testInput: e.detail.value });
  },
  
  // 执行规则测试
  runTest() {
    const { testInput, formData, customMapping } = this.data;
    const steps = [];
    
    // 清除之前的结果
    this.setData({ testResult: null, testError: null, testNoMatch: null, testSteps: [] });
    
    // 验证输入
    if (!testInput) {
      this.setData({ testError: '请输入测试内容' });
      return;
    }
    
    if (!formData.pattern) {
      this.setData({ testError: '请先填写「匹配关键词」' });
      return;
    }
    
    try {
      // 步骤1：验证正则表达式
      let regex;
      try {
        regex = new RegExp(formData.pattern);
        steps.push({
          name: '正则表达式验证',
          input: formData.pattern,
          output: '✓ 语法正确',
          status: 'success'
        });
      } catch (e) {
        steps.push({
          name: '正则表达式验证',
          input: formData.pattern,
          error: '语法错误: ' + e.message,
          status: 'error'
        });
        this.setData({ testSteps: steps, testError: '正则表达式语法错误' });
        return;
      }
      
      // 步骤2：长度检查
      const codeLength = testInput.length;
      if (formData.lengthEnabled) {
        const minLen = formData.minLength ? parseInt(formData.minLength) : 0;
        const maxLen = formData.maxLength ? parseInt(formData.maxLength) : Infinity;
        const lenOk = codeLength >= minLen && codeLength <= maxLen;
        steps.push({
          name: '长度检查',
          input: `长度=${codeLength}, 范围=${minLen}-${maxLen === Infinity ? '∞' : maxLen}`,
          output: lenOk ? `✓ 通过 (${codeLength}位在范围内)` : `✗ 不通过 (${codeLength}位超出范围)`,
          status: lenOk ? 'success' : 'error'
        });
        if (!lenOk) {
          this.setData({ testSteps: steps, testNoMatch: `长度不满足条件：${codeLength}位，需要${minLen}-${maxLen === Infinity ? '无限' : maxLen}位` });
          return;
        }
      } else {
        steps.push({
          name: '长度检查',
          input: `长度=${codeLength}`,
          output: '✓ 未启用长度限制',
          status: 'success'
        });
      }
      
      // 步骤3：正则匹配
      const matched = regex.test(testInput);
      steps.push({
        name: '正则匹配',
        input: `关键词: ${formData.pattern}\n内容: ${testInput}`,
        output: matched ? `✓ 匹配成功` : `✗ 未匹配`,
        status: matched ? 'success' : 'error'
      });
      
      if (!matched) {
        this.setData({ testSteps: steps, testNoMatch: '正则表达式未匹配到内容' });
        return;
      }
      
      // 步骤4：提取内容
      let extracted = testInput;
      
      if (formData.extract === '提取位置' && formData.startPos && formData.endPos) {
        const start = parseInt(formData.startPos) - 1;
        const end = parseInt(formData.endPos);
        extracted = testInput.substring(start, end);
        extractDesc = `位置 ${formData.startPos}-${formData.endPos}`;
        steps.push({
          name: '内容提取',
          input: `方式: 提取位置 (${formData.startPos}-${formData.endPos})\n原始: ${testInput}`,
          output: `提取结果: ${extracted}`,
          status: 'success'
        });
      } else if (formData.extract === '匹配的全部') {
        extractDesc = '匹配的全部';
        steps.push({
          name: '内容提取',
          input: `方式: 匹配的全部\n原始: ${testInput}`,
          output: `提取结果: ${extracted}`,
          status: 'success'
        });
      } else if (formData.extract === '域名') {
        try {
          const url = new URL(testInput.startsWith('http') ? testInput : 'http://' + testInput);
          extracted = url.hostname;
          steps.push({
            name: '内容提取',
            input: `方式: 域名\n原始: ${testInput}`,
            output: `域名: ${extracted}`,
            status: 'success'
          });
        } catch (e) {
          steps.push({
            name: '内容提取',
            input: `方式: 域名\n原始: ${testInput}`,
            error: '无法提取域名: ' + e.message,
            status: 'error'
          });
        }
      } else if (formData.extract === '@后的域名') {
        const atIndex = testInput.indexOf('@');
        if (atIndex !== -1) {
          const afterAt = testInput.substring(atIndex + 1);
          const dotIndex = afterAt.indexOf('.');
          extracted = dotIndex !== -1 ? afterAt.substring(0, dotIndex) : afterAt;
          steps.push({
            name: '内容提取',
            input: `方式: @后的域名\n原始: ${testInput}`,
            output: `提取结果: ${extracted}`,
            status: 'success'
          });
        } else {
          steps.push({
            name: '内容提取',
            input: `方式: @后的域名\n原始: ${testInput}`,
            error: '未找到 @ 符号',
            status: 'error'
          });
        }
      } else {
        steps.push({
          name: '内容提取',
          input: `方式: ${formData.extract || '匹配的全部'}\n原始: ${testInput}`,
          output: `提取结果: ${extracted}`,
          status: 'success'
        });
      }
      
      // 步骤5：日期转换
      let finalValue = extracted;
      let isDate = false;
      
      if (formData.dateMapping && formData.dateMapping.enabled) {
        const mapping = formData.dateMapping;
        let convertedDate = '';
        
        // 更新日期映射
        app.updateDateMapping(customMapping);
        const maps = app.DATE_CODE_MAPS;
        
        // 年份转换
        if (mapping.yearPos && mapping.yearPos > 0 && mapping.yearPos <= testInput.length) {
          const yearChar = testInput[mapping.yearPos - 1];
          let year = null;
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
        
        // 月份转换
        if (mapping.monthPos && mapping.monthPos > 0 && mapping.monthPos <= testInput.length) {
          const monthChar = testInput[mapping.monthPos - 1];
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
        
        // 日期转换
        if (mapping.dayPos && mapping.dayPos > 0 && mapping.dayPos <= testInput.length) {
          const dayChar = testInput[mapping.dayPos - 1];
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
          finalValue = convertedDate;
          isDate = true;
          steps.push({
            name: '日期转换',
            input: `位置: 年${mapping.yearPos || '-'}/月${mapping.monthPos || '-'}/日${mapping.dayPos || '-'}`,
            output: `转换结果: ${finalValue}`,
            status: 'success'
          });
        } else {
          steps.push({
            name: '日期转换',
            input: `已启用，但位置不完整`,
            output: '转换未成功，保持原值',
            status: 'pending'
          });
        }
      } else {
        steps.push({
          name: '日期转换',
          input: '未启用',
          output: '跳过',
          status: 'pending'
        });
      }
      
      // 设置最终结果
      this.setData({
        testSteps: steps,
        testResult: {
          label: formData.label || '测试结果',
          value: finalValue,
          rawValue: extracted,
          matched: true,
          isDate: isDate,
          lengthChecked: formData.lengthEnabled
        }
      });
      
    } catch (err) {
      this.setData({
        testSteps: steps,
        testError: '测试失败: ' + err.message
      });
    }
  },
  
  // 清除测试结果
  clearTest() {
    this.setData({
      testInput: '',
      testResult: null,
      testError: null,
      testNoMatch: null,
      testSteps: []
    });
  }
});
