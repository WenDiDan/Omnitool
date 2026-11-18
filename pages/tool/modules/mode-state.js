/**
 * 互助工具 · 模式状态方法
 *
 * 以「页面方法对象」形式导出，通过 Object.assign 合并进 Page，
 * 因此方法内的 this 仍是页面实例，与原实现完全一致。
 */

const {
  MODE_STATE_CACHE_KEY,
  MODE_LABELS,
  MODE_RULES,
  resolveLimits,
  createModeState
} = require('./mode-config.js');

module.exports = {
  /** 跨天兜底：后台驻留跨天后，内存里的次数必须归零（否则会被持久化成"今天的数据"） */
  ensureSameDay() {
    const today = new Date().toDateString();
    if (this._stateDay === today) return;
    this._stateDay = today;
    let changed = false;
    this._modeStates.forEach((s) => {
      if (s.helpUsed || s.receiveUsed || s.task) changed = true;
      s.helpUsed = 0;
      s.receiveUsed = 0;
      s.task = null;
    });
    if (!changed) return;
    this.stopTaskTimer();
    this.setData({ taskCountdown: '' });
    this.syncCurrent();
    this.persistModeStates();
  },

  localDateKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  /** 初始化 / 补齐两个模式的独立状态 */
  ensureModeStates(tool) {
    const count = Math.max(2, (this.data.modes && this.data.modes.length) || 2);
    if (!this._modeStates.length) {
      this._modeStates = Array.from({ length: count }, (_, i) => createModeState(i, tool));
    }
    // 上限一律按模式取工具配置（个人赛 10、车队 6），保留用户已改的设置
    this._modeStates.forEach((state, i) => {
      const lim = resolveLimits(i, tool);
      state.label = MODE_LABELS[i] || `模式${i + 1}`;
      state.helpLimit = lim.helpLimit;
      state.receiveLimit = lim.receiveLimit;
      // 自定义名额不能超过新的受助上限
      if (typeof state.helpQuota !== 'number' || state.helpQuota > lim.receiveLimit) {
        state.helpQuota = lim.receiveLimit;
      }
    });
    this.syncCurrent();
    this.persistModeStates();
  },

  /** 按当前模式的界面规则生成受助设置弹窗内容 */
  buildSettings(state, index) {
    const rule = MODE_RULES[index] || MODE_RULES[0];
    const rows = rule.rows.map((row) => {
      const item = {
        key: row.key,
        label: row.label,
        action: row.action,
        disabled: !!row.disabled,
        valueText: ''
      };
      if (row.labelFrom === 'pause') {
        item.label = state.paused ? '恢复受助' : '暂停受助';
      }
      if (row.valueFrom === 'quota') item.valueText = `${state.helpQuota} 人`;
      if (row.valueFrom === 'carLevel') item.valueText = `Lv.${state.carLevel}`;
      if (row.valueFrom === 'teamNo') item.valueText = state.teamNo || '—';
      return item;
    });

    return {
      title: rule.title,
      modeLabel: rule.label,
      status: state.paused ? rule.statusPaused : rule.statusNormal,
      rows
    };
  },

  /** 把当前模式状态展开成渲染用数据；弹窗规则按 settingsMode 生成 */
  syncCurrent() {
    const index = this.data.activeMode;
    const state = this._modeStates[index] || this._modeStates[0] || createModeState(0, this.data.tool);

    const settingsState = this._modeStates[this.data.settingsMode]
      || createModeState(this.data.settingsMode, this.data.tool);

    const modeHelpLeft = this._modeStates.map(
      (s) => Math.max(0, s.helpLimit - s.helpUsed)
    );

    const helpLeft = Math.max(0, state.helpLimit - state.helpUsed);
    const receiveLeft = Math.max(0, state.receiveLimit - state.receiveUsed);
    const quota = typeof state.quota === 'number' ? state.quota : 1;
    const publishHint = quota >= 1
      ? '尚未设置口令，点击「编辑」粘贴淘口令或助力链接'
      : `受助机会 ${quota} 次，还差 ${1 - quota} 次解锁发布`;
    this.setData({
      current: {
        ...state,
        helpLeft,
        receiveLeft,
        quota,
        publishHint,
        helpPercent: Math.min(100, Math.round(((state.helpLimit - helpLeft) / Math.max(1, state.helpLimit)) * 100)),
        receivePercent: Math.min(100, Math.round(((state.receiveLimit - receiveLeft) / Math.max(1, state.receiveLimit)) * 100))
      },
      modeHelpLeft,
      settings: this.buildSettings(settingsState, this.data.settingsMode)
    });
  },

  /** 修改指定模式的字段（默认弹窗模式；看板可传 activeMode） */
  updateMode(patch, indexOverride) {
    const index = typeof indexOverride === 'number' ? indexOverride : this.data.settingsMode;
    if (!this._modeStates[index]) this._modeStates[index] = createModeState(index, this.data.tool);
    Object.assign(this._modeStates[index], patch);
    this.syncCurrent();
    this.persistModeStates();
  },

  modeStateKey() {
    return (this.data.tool && this.data.tool.tool_key) || 'default';
  },

  restoreModeStates(key) {
    this._stateDay = new Date().toDateString();
    try {
      const cached = wx.getStorageSync(MODE_STATE_CACHE_KEY);
      if (cached && cached[key] && Array.isArray(cached[key].states)) {
        const sameDay = cached[key].date === new Date().toDateString();
        this._modeStates = cached[key].states.map((s, i) => {
          const base = createModeState(i, this.data.tool);
          const src = s || {};
          // 上限永远以工具配置为准，绝不从旧缓存恢复（否则车队会被旧值 10 覆盖）
          return {
            ...base,
            ...src,
            label: base.label,
            helpLimit: base.helpLimit,
            receiveLimit: base.receiveLimit,
            helpQuota: Math.min(
              typeof src.helpQuota === 'number' && src.helpQuota > 0 ? src.helpQuota : base.helpQuota,
              base.receiveLimit
            ),
            // 次数只当天有效：跨天保留设置项，次数归零（云端会以当天数据覆盖）
            helpUsed: sameDay ? (src.helpUsed || 0) : 0,
            receiveUsed: sameDay ? (src.receiveUsed || 0) : 0,
            command: '', // 口令只存云端且仅当天有效，不从本地缓存恢复
            task: null   // 进行中的任务不跨会话保留
          };
        });
        this.syncCurrent();
      }
    } catch (e) { /* 忽略 */ }
  },

  persistModeStates() {
    try {
      const cached = wx.getStorageSync(MODE_STATE_CACHE_KEY) || {};
      // 口令不写本地缓存（仅云端、仅当天）；进行中任务不持久化
      const states = this._modeStates.map(s => ({ ...s, command: '', task: null }));
      cached[this.modeStateKey()] = {
        states,
        date: new Date().toDateString()
      };
      wx.setStorageSync(MODE_STATE_CACHE_KEY, cached);
    } catch (e) { /* 忽略 */ }
  }
};
