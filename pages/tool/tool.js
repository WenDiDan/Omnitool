const Toast = require('tdesign-miniprogram/toast/index').default;
const Dialog = require('tdesign-miniprogram/dialog/index').default;
const toolsService = require('../../utils/tools.js');

const ACCOUNT_CACHE_KEY = 'toolAccountCache';
const ACCOUNT_CACHE_VERSION = 2; // 编号规则变更时递增，使旧缓存失效
const MODE_STATE_CACHE_KEY = 'toolModeStateCache';
const BLOCK_KEY = 'toolBlockList';
const TASK_SECONDS_DEFAULT = 300; // 任务有效期兜底 5 分钟，实际以工具配置 task_seconds 为准
const MODE_LABELS = ['个人赛助力', '车队助力'];

/**
 * 两个模式各自独立的界面规则（受助设置弹窗完全由规则渲染）
 * rows: key / label / action / valueFrom / labelFrom / disabled
 */
const MODE_RULES = [
  {
    key: 'solo',
    label: '个人赛助力',
    title: '我的受助设置',
    statusNormal: '受助状态：今天设置的受助人数已安排完，暂不安排新助力。',
    statusPaused: '受助状态：已暂停受助，暂不安排新助力。',
    rows: [
      { key: 'quota', label: '调整剩余受助人数', action: 'adjustQuota', valueFrom: 'quota' },
      { key: 'pause', action: 'togglePause', labelFrom: 'pause' },
      { key: 'invite', label: '撤回未确认邀请', action: 'onInvite' }
    ]
  },
  {
    key: 'team',
    label: '车队助力',
    title: '车队受助设置',
    statusNormal: '受助状态：今日方式已锁定，车队按已安排人数接受助力。',
    statusPaused: '受助状态：已暂停受助，暂不安排新助力。',
    rows: [
      { key: 'quota', label: '调整剩余受助人数', action: 'adjustQuota', valueFrom: 'quota' },
      { key: 'pause', action: 'togglePause', labelFrom: 'pause' },
      { key: 'locked', label: '今日方式已锁定', action: 'onLocked', disabled: true },
      { key: 'carLevel', label: '更新赛车等级', action: 'updateCarLevel', valueFrom: 'carLevel' },
      { key: 'teamInfo', label: '车队编号与成员', action: 'onTeamInfo', valueFrom: 'teamNo' }
    ]
  }
];

/** 按模式解析当天上限：个人赛 10/10，车队 PK 6/6（旧全局字段无法表达差异，不作兜底） */
function resolveLimits(index, tool) {
  const isTeam = index === 1;
  const per = (v, def) => (typeof v === 'number' && v > 0 ? v : def);
  return {
    helpLimit: per(tool && (isTeam ? tool.daily_help_limit_team : tool.daily_help_limit_solo), isTeam ? 6 : 10),
    receiveLimit: per(tool && (isTeam ? tool.daily_receive_limit_team : tool.daily_receive_limit_solo), isTeam ? 6 : 10)
  };
}

/** 每个模式一套独立状态 */
function createModeState(index, tool) {
  const { helpLimit, receiveLimit } = resolveLimits(index, tool);
  return {
    key: index === 0 ? 'solo' : 'team',
    label: MODE_LABELS[index] || `模式${index + 1}`,
    helpLimit,
    receiveLimit,
    helpUsed: 0,
    receiveUsed: 0,
    quota: 1,
    helpQuota: receiveLimit,
    paused: false,
    carLevel: 1,
    teamNo: '—',
    command: '',
    task: null
  };
}

Page({
  data: {
    tool: null,
    ruleLines: [],
    loading: true,
    notFound: false,
    // 0 开始助力 / 1 记录 / 2 个人中心 —— 同页切换，不跳转
    activeTab: 0,
    activeMode: 0,
    modes: [],
    showRules: false,
    showMore: false,
    // 当前模式的独立状态（由 _modeStates 派生，仅供渲染）
    current: {
      label: '个人赛助力',
      helpLimit: 10,
      receiveLimit: 10,
      helpUsed: 0,
      helpLeft: 10,
      receiveUsed: 0,
      receiveLeft: 10,
      helpQuota: 10,
      paused: false,
      carLevel: 1,
      teamNo: '—',
      command: '',
      task: null
    },
    taskCountdown: '',
    drawing: false,
    recordsList: [],
    recordGroups: [],
    recordType: 'help',
    recordFilter: 'all',
    recordCounts: { all: 0, done: 0, pending: 0, returned: 0, ongoing: 0 },
    recordsLoading: false,
    // 当前模式的受助设置界面（由 MODE_RULES 生成）
    settings: { title: '', modeLabel: '', status: '', rows: [] },
    settingsMode: 0,
    modeHelpLeft: [10, 10],
    // 个人中心：仅登记展示昵称与可选头像
    account: null,
    avatarText: '登',
    avatarPreview: '',
    saving: false,
    showEdit: false,
    agreed: false,
    showHelpSettings: false,
    form: {
      tb_nick: '',
      avatar_url: '',
      avatarTemp: ''
    }
  },

  _modeStates: [],

  onLoad(options) {
    const key = options.key || '';
    const tool = toolsService.getTool(key);

    // 先恢复两个模式的本地设置，applyTool 再按工具配置补齐上限
    this.restoreModeStates(key);

    if (tool) {
      this.applyTool(tool);
    } else {
      // 缓存里没有（冷启动直连），先拉云端再查
      toolsService.refreshTools(true).then(() => {
        const found = toolsService.getTool(key);
        if (found) {
          this.applyTool(found);
        } else {
          this.setData({ loading: false, notFound: true });
        }
      }).catch(() => {
        this.setData({ loading: false, notFound: true });
      });
    }

    this.restoreAccountCache(key);
    this.loadAccount();
    this.loadCommands();
  },

  onShow() {
    // 小程序可能被挂在后台跨天，回来时先把昨天的次数清掉，再以云端为准刷新
    this.ensureSameDay();
    // 每次回前台都拉云端：受助次数（口令被完成）由别人触发，只有拉取才能看到变化
    this.loadCommands();
    // 从后台回来：恢复当前模式任务倒计时；已过期的会由 tick 立即释放并退回次数
    const state = this._modeStates[this.data.activeMode];
    if (state && state.task) this.startTaskTimer();
    // 停留页面期间轻量轮询，别人完成助力后 30 秒内受助数字可见变化
    this.startReceivePolling();
  },

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

  /** 受助次数轮询：页面显示期间每 30 秒拉一次云端统计 */
  startReceivePolling() {
    this.stopReceivePolling();
    this._receivePoll = setInterval(() => this.loadCommands(), 30000);
  },

  stopReceivePolling() {
    if (this._receivePoll) {
      clearInterval(this._receivePoll);
      this._receivePoll = null;
    }
  },

  localDateKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  /** 从云端读取今天两个模式的口令 */
  loadCommands() {
    wx.cloud.callFunction({
      name: 'toolsManage',
      data: {
        action: 'getCommands',
        tool_key: this.modeStateKey()
      },
      success: (res) => {
        const result = res && res.result;
        if (!result || !result.success) return;
        const commands = result.commands || {};
        const receiveDone = result.receive_done || {};
        const helpUsed = result.help_used || {};
        const quota = result.quota || {};
        ['solo', 'team'].forEach((mode, i) => {
          if (!this._modeStates[i]) this._modeStates[i] = createModeState(i, this.data.tool);
          this._modeStates[i].command = commands[mode] || '';
          // 已成功受助数 = 本人口令当天被完成数：云端是唯一权威，不做本地累加
          if (typeof receiveDone[mode] === 'number') {
            this._modeStates[i].receiveUsed = receiveDone[mode];
          }
          // 助人已用次数以云端为准（只保存当天）；有进行中任务时本地为准，防旧值覆盖
          if (typeof helpUsed[mode] === 'number' && !(this._modeStates[i] && this._modeStates[i].task)) {
            this._modeStates[i].helpUsed = helpUsed[mode];
          }
          // 受助机会余额（跨天结转，可为负）
          if (typeof quota[mode] === 'number') {
            this._modeStates[i].quota = quota[mode];
          }
        });
        this._lastCommandDate = result.date || this.localDateKey();
        this.syncCurrent();
      },
      fail: () => { /* 保留空口令，不阻塞页面 */ }
    });
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
  },

  applyTool(tool) {
    const ruleLines = (tool.rules_text || '')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map((text, i) => ({ no: String(i + 1).padStart(2, '0'), text }));

    const modes = Array.isArray(tool.mode_tabs) && tool.mode_tabs.length
      ? tool.mode_tabs
      : (tool.modes ? tool.modes.split('/').map(s => s.trim()).filter(Boolean) : []);

    this.setData({
      tool,
      ruleLines,
      modes,
      loading: false,
      notFound: false
    });
    this.ensureModeStates(tool);
    wx.setNavigationBarTitle({ title: tool.name || '工具详情' });
  },

  // ===== 三个 Tab 切换 =====
  switchTab(e) {
    const index = Number(e.currentTarget.dataset.index) || 0;
    this.setData({ activeTab: index });
    if (index === 1) this.loadRecords();
  },

  goBackBoard() {
    this.setData({ activeTab: 0 });
  },

  showStats() {
    this.setData({ activeTab: 1 });
  },

  switchMode(e) {
    const index = Number(e.currentTarget.dataset.index) || 0;
    this.setData({ activeMode: index }, () => {
      this.syncCurrent();
      this.loadRecords();
      // 切换后若该模式有进行中的任务，恢复倒计时
      const state = this._modeStates[index];
      if (state && state.task) this.startTaskTimer();
      else this.setData({ taskCountdown: '' });
    });
  },

  onHide() {
    this.stopTaskTimer();
    this.stopReceivePolling();
  },

  onUnload() {
    this.stopTaskTimer();
    this.stopReceivePolling();
  },

  toggleRules() {
    this.setData({ showRules: !this.data.showRules });
  },

  toggleMore() {
    this.setData({ showMore: !this.data.showMore });
  },

  // ===== 通用操作 =====
  copyLink() {
    let url = this.data.tool && this.data.tool.activity_url;
    // 黑名单过滤：禁止跳转/复制第三方遗留链接
    if (url && /ujd6\.cn/i.test(url)) url = '';
    if (!url) {
      Toast({ context: this, selector: '#t-toast', message: '暂无活动链接' });
      return;
    }
    wx.setClipboardData({
      data: url,
      success: () => {
        Toast({ context: this, selector: '#t-toast', message: '链接已复制，请到浏览器或淘宝打开', duration: 2500 });
      }
    });
  },

  showNotice() {
    const notice = (this.data.tool && this.data.tool.board_notice) || '暂无公告';
    Dialog.alert({ context: this, selector: '#t-dialog', title: '通知 / 公告', content: notice, showCancel: false, content: notice, showCancel: false });
  },

  showHelp() {
    Dialog.alert({ context: this, selector: '#t-dialog', title: '帮助与反馈',
      content: (this.data.tool && this.data.tool.source_note) || '规则以活动页实时显示为准。',
      showCancel: false, content: (this.data.tool && this.data.tool.source_note) || '规则以活动页实时显示为准。',
      showCancel: false });
  },

  onRefresh() {
    wx.showLoading({ title: '刷新中', mask: true });
    toolsService.refreshTools(true).then((res) => {
      if (res.success) {
        const tool = toolsService.getTool(this.data.tool && this.data.tool.tool_key);
        if (tool) this.applyTool(tool);
        Toast({ context: this, selector: '#t-toast', message: '已更新', theme: 'success' });
      } else {
        Toast({ context: this, selector: '#t-toast', message: '同步失败，显示本地内容' });
      }
      this.loadAccount();
      this.loadCommands();
    }).catch(() => {
      Toast({ context: this, selector: '#t-toast', message: '同步失败，显示本地内容' });
    }).then(() => {
      wx.hideLoading();
    });
  },

  // ===== 个人中心：登记资料 =====
  accountKey() {
    return (this.data.tool && this.data.tool.tool_key) || 'default';
  },

  /** cloud:// 转可渲染的 https 临时链接，失败则保留原值 */
  resolveAvatar(url) {
    if (!url || url.indexOf('cloud://') !== 0) return Promise.resolve(url || '');
    return wx.cloud.getTempFileURL({
      fileList: [{ fileID: url, maxAge: 0 }]
    }).then((res) => {
      const file = res.fileList && res.fileList[0];
      return (file && file.tempFileURL) || url;
    }).catch(() => url);
  },

  setAvatarPreview(url) {
    this.resolveAvatar(url).then((preview) => {
      this.setData({ avatarPreview: preview });
    });
  },

  restoreAccountCache(key) {
    try {
      const cached = wx.getStorageSync(ACCOUNT_CACHE_KEY);
      // 版本不匹配（旧哈希编号）或结构异常时忽略缓存，等待云端返回正确编号
      if (!cached || cached.version !== ACCOUNT_CACHE_VERSION) return;
      if (cached[key]) {
        this.setData({
          account: cached[key],
          avatarText: (cached[key].tb_nick || '登').charAt(0)
        });
        this.setAvatarPreview(cached[key].avatar_url);
      }
    } catch (e) { /* 忽略 */ }
  },

  loadAccount() {
    wx.cloud.callFunction({
      name: 'toolsManage',
      data: { action: 'getAccount' },
      success: (res) => {
        const result = res && res.result;
        if (result && result.success) this.applyAccount(result.account);
      },
      fail: () => { /* 保留本地缓存 */ }
    });
  },

  applyAccount(account) {
    const key = this.accountKey();
    this.setData({
      account: account || null,
      avatarText: (account && account.tb_nick ? account.tb_nick : '登').charAt(0)
    });
    // 云端受助设置回到本地：自定义名额与暂停状态以云端为准
    if (account) {
      if (typeof account.quota_solo === 'number' && account.quota_solo > 0) {
        this._modeStates[0].helpQuota = Math.min(this._modeStates[0].receiveLimit, account.quota_solo);
      }
      if (typeof account.quota_team === 'number' && account.quota_team > 0) {
        this._modeStates[1].helpQuota = Math.min(this._modeStates[1].receiveLimit, account.quota_team);
      }
      if (typeof account.paused_solo === 'boolean') this._modeStates[0].paused = account.paused_solo;
      if (typeof account.paused_team === 'boolean') this._modeStates[1].paused = account.paused_team;
      this.syncCurrent();
    }
    this.setAvatarPreview(account && account.avatar_url);
    try {
      const cached = wx.getStorageSync(ACCOUNT_CACHE_KEY) || {};
      if (cached.version !== ACCOUNT_CACHE_VERSION) {
        Object.keys(cached).forEach(k => delete cached[k]);
        cached.version = ACCOUNT_CACHE_VERSION;
      }
      cached[key] = account || null;
      wx.setStorageSync(ACCOUNT_CACHE_KEY, cached);
    } catch (e) { /* 忽略 */ }
  },

  openEdit() {
    const a = this.data.account || {};
    this.setData({
      showEdit: true,
      agreed: !!a.tb_nick,
      form: {
        tb_nick: a.tb_nick || '',
        avatar_url: a.avatar_url || '',
        avatarTemp: ''
      }
    });
    this.setAvatarPreview(a.avatar_url);
  },

  closeEdit() {
    this.setData({ showEdit: false });
  },

  noop() {},

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  toggleAgree() {
    this.setData({ agreed: !this.data.agreed });
  },

  showPolicy() {
    Dialog.alert({ context: this, selector: '#t-dialog', title: '资料说明',
      content: '仅登记淘宝显示昵称与可选头像，用于互助时展示给对方核对。请勿填写登录账号、手机号等信息；上传截图前请先遮住账号、订单、手机号等敏感内容。',
      showCancel: false, content: '仅登记淘宝显示昵称与可选头像，用于互助时展示给对方核对。请勿填写登录账号、手机号等信息；上传截图前请先遮住账号、订单、手机号等敏感内容。',
      showCancel: false });
  },

  /** 选择头像：本机压缩，上限 10MB */
  chooseAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) {
          Toast({ context: this, selector: '#t-toast', message: '原图不能超过 10MB' });
          return;
        }
        this.setData({
          'form.avatarTemp': file.tempFilePath,
          avatarPreview: file.tempFilePath
        });
      }
    });
  },

  removeAvatar() {
    this.setData({
      'form.avatarTemp': '',
      'form.avatar_url': '',
      avatarPreview: ''
    });
  },

  /** 有新选头像时先上传云存储，再保存资料 */
  uploadAvatarIfNeeded(tempPath) {
    if (!tempPath) return Promise.resolve('');
    const ext = tempPath.split('.').pop() || 'jpg';
    const cloudPath = `tool-avatars/${Date.now()}-${Math.floor(Math.random() * 100000)}.${ext}`;
    return wx.cloud.uploadFile({ cloudPath, filePath: tempPath })
      .then(res => res.fileID || '')
      .catch(() => '');
  },

  saveAccount() {
    const form = this.data.form;
    if (!form.tb_nick.trim()) {
      Toast({ context: this, selector: '#t-toast', message: '请填写淘宝显示昵称' });
      return;
    }
    if (!this.data.agreed) {
      Toast({ context: this, selector: '#t-toast', message: '请先同意资料说明' });
      return;
    }
    if (this.data.saving) return;

    this.setData({ saving: true });
    wx.showLoading({ title: '保存中', mask: true });

    this.uploadAvatarIfNeeded(form.avatarTemp).then((fileID) => {
      const avatar_url = form.avatarTemp ? fileID : form.avatar_url;
      if (form.avatarTemp && !fileID) {
        wx.hideLoading();
        this.setData({ saving: false });
        Toast({ context: this, selector: '#t-toast', message: '头像上传失败，请重试' });
        return;
      }

      wx.cloud.callFunction({
        name: 'toolsManage',
        data: {
          action: 'saveAccount',
          account: {
            tool_key: this.accountKey(),
            tb_nick: form.tb_nick,
            avatar_url
          }
        },
        success: (res) => {
          const result = res && res.result;
          if (result && result.success) {
            this.applyAccount(result.account);
            this.setData({ showEdit: false });
            Toast({ context: this, selector: '#t-toast', message: '已保存', theme: 'success' });
          } else {
            Toast({ context: this, selector: '#t-toast', message: '保存失败，请重试' });
          }
        },
        fail: () => {
          Toast({ context: this, selector: '#t-toast', message: '云端不可用，请稍后重试' });
        },
        complete: () => {
          wx.hideLoading();
          this.setData({ saving: false });
        }
      });
    });
  },

  onFeature(e) {
    const name = e.currentTarget.dataset.name || '该功能';
    Toast({ context: this, selector: '#t-toast', message: `${name}` });
  },

  // ===== 受助设置 =====
  openHelpSettings(e) {
    const mode = Number((e && e.currentTarget.dataset.mode) || 0);
    this.setData({ settingsMode: mode, showHelpSettings: true }, () => this.syncCurrent());
  },

  closeHelpSettings() {
    this.setData({ showHelpSettings: false });
  },

  /** 受助设置行点击统一分发 */
  onSettingAction(e) {
    const action = e.currentTarget.dataset.action;
    const handlers = {
      adjustQuota: this.adjustQuota,
      togglePause: this.togglePause,
      onLocked: this.onLocked,
      updateCarLevel: this.updateCarLevel,
      onInvite: this.onInvite,
      onTeamInfo: this.onTeamInfo
    };
    const fn = handlers[action];
    if (typeof fn === 'function') fn.call(this);
  },

  /** 个人赛助力：撤回未确认邀请 */
  onInvite() {
    Toast({ context: this, selector: '#t-toast', message: '暂无未确认邀请' });
  },

  /** 车队助力：查看车队编号与成员 */
  onTeamInfo() {
    const no = this.settingsState().teamNo || '—';
    Dialog.alert({ context: this, selector: '#t-dialog', title: '车队信息',
      content: no === '—' ? '尚未加入车队' : `车队编号：${no}` });
  },

  /** 未登记引导：跳转个人中心登记资料 */
  promptRegister() {
    Dialog.confirm({
      context: this,
      selector: '#t-dialog',
      title: '需要先登记',
      content: '登记昵称与头像后才能参与口令互助，是否前往登记？',
      confirmBtn: '去登记',
      cancelBtn: '取消'
    }).then(() => {
      this.setData({ activeTab: 2 });
    }).catch(() => {});
  },

  /** 更新当前助力模式的口令（写云端，仅当天有效） */
  editCommand() {
    const current = this.data.current;
    const mode = this.data.activeMode === 0 ? 'solo' : 'team';

    wx.showModal({
      title: `${current.label} · 我的口令`,
      editable: true,
      placeholderText: '粘贴淘口令或助力链接',
      content: current.command || '',
      success: (res) => {
        if (!res.confirm) return;
        const command = String(res.content || '').trim().slice(0, 500);

        wx.showLoading({ title: '保存中', mask: true });
        wx.cloud.callFunction({
          name: 'toolsManage',
          data: {
            action: 'saveCommand',
            tool_key: this.modeStateKey(),
            mode,
            command
          },
          success: (r) => {
            const result = r && r.result;
            if (!result || !result.success) {
              if (result && result.error === 'NOT_REGISTERED') {
                wx.hideLoading();
                this.promptRegister();
                return;
              }
              if (result && result.error === 'INVALID_COMMAND') {
                Toast({ context: this, selector: '#t-toast', message: '口令太短，至少 5 个字符' });
                return;
              }
              if (result && result.error === 'BUSY') {
                Toast({ context: this, selector: '#t-toast', message: '口令正被助力，请稍后再改' });
                return;
              }
              if (result && result.error === 'NEED_HELP_FIRST') {
                wx.hideLoading();
                const lack = Math.max(1, 1 - (typeof result.quota === 'number' ? result.quota : 0));
                Dialog.confirm({
                  context: this,
                  selector: '#t-dialog',
                  title: '先助力，再发布',
                  content: `你的受助机会余额为 ${result.quota} 次，还差 ${lack} 次才能发布口令。\n规则：注册即赠 1 次，成功助力他人 +1 次，被他人助力 -1 次；不按天补充，亏欠会原样结转到次日，需继续助力补齐。`,
                  confirmBtn: '去助力',
                  cancelBtn: '知道了'
                }).then(() => {
                  this.switchTab({ currentTarget: { dataset: { index: 0 } } });
                }).catch(() => {});
                return;
              }
              Toast({ context: this, selector: '#t-toast', message: '保存失败，请重试' });
              return;
            }
            this.updateMode({ command: result.command }, this.data.activeMode);
            this._lastCommandDate = result.date || this.localDateKey();
            Toast({ context: this, selector: '#t-toast', message: command ? '口令已更新' : '口令已清空', theme: 'success' });
          },
          fail: () => {
            Toast({ context: this, selector: '#t-toast', message: '云端不可用，请稍后重试' });
          },
          complete: () => wx.hideLoading()
        });
      }
    });
  },

  /** 复制当前助力模式的口令 */
  copyCommand() {
    const command = this.data.current.command;
    if (!command) {
      Toast({ context: this, selector: '#t-toast', message: '尚未设置口令' });
      return;
    }
    wx.setClipboardData({
      data: command,
      success: () => Toast({ context: this, selector: '#t-toast', message: '口令已复制', theme: 'success' })
    });
  },

  /** 领取口令：从云端口令池抽一条非本人的口令；匹配成功才扣次数 */
  drawCommand(swapsLeft, extraExclude) {
    if (this.data.drawing) return;
    const state = this._modeStates[this.data.activeMode];
    if (!state) return;
    if (state.task) {
      Toast({ context: this, selector: '#t-toast', message: '已有进行中的任务' });
      return;
    }
    if (state.helpLeft !== undefined && state.helpLimit - state.helpUsed <= 0) {
      Toast({ context: this, selector: '#t-toast', message: '今日助人次数已用完' });
      return;
    }

    this.setData({ drawing: true });
    const mode = this.data.activeMode === 0 ? 'solo' : 'team';
    const exclude = this.getBlockList();
    if (extraExclude) exclude.push(extraExclude);
    wx.cloud.callFunction({
      name: 'toolsManage',
      data: {
        action: 'drawCommand',
        tool_key: this.modeStateKey(),
        mode,
        exclude_nicks: exclude
      },
      success: (r) => {
        const result = r && r.result;
        if (!result || !result.success) {
          if (result && result.error === 'NOT_REGISTERED') {
            this.promptRegister();
            return;
          }
          if (result && result.error === 'LIMIT_REACHED') {
            Toast({ context: this, selector: '#t-toast', message: '今日助人次数已用完' });
            this.loadCommands();
            return;
          }
          Toast({ context: this, selector: '#t-toast', message: '领取失败，请重试' });
          return;
        }
        if (!result.matched) {
          // 空池：没设口令的人先发布口令，池子才会有人可被助力
          const hasCommand = !!(this.data.current && this.data.current.command);
          if (!hasCommand) {
            Dialog.confirm({
              context: this,
              selector: '#t-dialog',
              title: '暂时没有可匹配的口令',
              content: '你还没有设置自己的口令。先发布口令让别人助力你，同时也会增加口令池供给，更容易匹配到人。',
              confirmBtn: '去设置',
              cancelBtn: '稍后'
            }).then(() => {
              this.editCommand();
            }).catch(() => {});
          } else {
            Toast({ context: this, selector: '#t-toast', message: '暂无匹配，不扣次数' });
          }
          return;
        }

        const t = result.task;
        this.updateMode({
          helpUsed: state.helpUsed + 1,
          task: {
            taskId: t.task_id,
            command: t.command,
            nick: t.nick,
            avatar_url: t.avatar_url,
            avatarText: (t.nick || '淘').charAt(0),
            swapsLeft: typeof swapsLeft === 'number' ? swapsLeft : 3,
            deadline: Date.now() + ((this.data.tool && this.data.tool.task_seconds) || TASK_SECONDS_DEFAULT) * 1000
          }
        }, this.data.activeMode);
        this.startTaskTimer();
        this.loadCommands();
      },
      fail: () => Toast({ context: this, selector: '#t-toast', message: '云端不可用，请稍后重试' }),
      complete: () => this.setData({ drawing: false })
    });
  },

  /** 启动任务倒计时（5:00），超时自动释放并退回次数 */
  startTaskTimer() {
    this.stopTaskTimer();
    const tick = () => {
      const state = this._modeStates[this.data.activeMode];
      const task = state && state.task;
      if (!task) { this.stopTaskTimer(); return; }
      const left = Math.max(0, Math.round((task.deadline - Date.now()) / 1000));
      const mm = String(Math.floor(left / 60)).padStart(2, '0');
      const ss = String(left % 60).padStart(2, '0');
      this.setData({ taskCountdown: `${mm}:${ss}` });
      if (left <= 0) {
        this.stopTaskTimer();
        this.releaseTask('任务已超时释放，次数已退回');
      }
    };
    tick();
    this._taskTimer = setInterval(tick, 1000);
  },

  stopTaskTimer() {
    if (this._taskTimer) {
      clearInterval(this._taskTimer);
      this._taskTimer = null;
    }
  },

  /** 回报口令状态：done 永久出池；available 退回池中。失败静默（云端有超时兜底） */
  notifyCommandStatus(taskId, status, proofFileId) {
    if (!taskId) return;
    wx.cloud.callFunction({
      name: 'toolsManage',
      data: {
        action: 'updateCommandStatus',
        task_id: taskId,
        status,
        proof_file_id: proofFileId || ''
      },
      fail: () => { /* 云端 6 分钟后自动兜底释放 */ }
    });
  },

  /** 释放当前任务：退回助人次数并清除任务（口令退回池中） */
  releaseTask(toast) {
    const state = this._modeStates[this.data.activeMode];
    if (!state || !state.task) return;
    this.stopTaskTimer();
    this.notifyCommandStatus(state.task.taskId, 'available');
    this.updateMode({
      helpUsed: Math.max(0, state.helpUsed - 1),
      task: null
    }, this.data.activeMode);
    this.setData({ taskCountdown: '' });
    if (toast) Toast({ context: this, selector: '#t-toast', message: toast });
  },

  /** 换一个：释放当前任务并重新领取（每日限 3 次） */
  swapTask() {
    const state = this._modeStates[this.data.activeMode];
    if (!state || !state.task) return;
    if (state.task.swapsLeft <= 0) {
      Toast({ context: this, selector: '#t-toast', message: '换的次数已用完，请完成或反馈失败' });
      return;
    }
    const nick = state.task.nick;
    const swapsLeft = state.task.swapsLeft - 1;
    const taskId = state.task.taskId;
    this.stopTaskTimer();
    this.notifyCommandStatus(taskId, 'available');
    this.updateMode({
      helpUsed: Math.max(0, state.helpUsed - 1),
      task: null
    }, this.data.activeMode);
    this.setData({ taskCountdown: '', drawing: false }, () => {
      this.drawCommand(swapsLeft, nick);
    });
  },

  /** 拉黑：不再匹配该昵称，并自动换下一个 */
  blockTask() {
    const state = this._modeStates[this.data.activeMode];
    if (!state || !state.task) return;
    const nick = state.task.nick;
    const swapsLeft = state.task.swapsLeft;
    const taskId = state.task.taskId;
    this.addBlockNick(nick);
    this.stopTaskTimer();
    this.notifyCommandStatus(taskId, 'available');
    this.updateMode({
      helpUsed: Math.max(0, state.helpUsed - 1),
      task: null
    }, this.data.activeMode);
    this.setData({ taskCountdown: '', drawing: false }, () => {
      this.drawCommand(swapsLeft, nick);
    });
  },

  /** 反馈失败：退回次数并释放任务 */
  reportFail() {
    const state = this._modeStates[this.data.activeMode];
    if (!state || !state.task) return;
    this.releaseTask('已反馈失败，次数已退回');
  },

  /** 提交助力结果（进入待核对）：车队必须先上传截图，个人赛直接提交 */
  markSuccess() {
    const state = this._modeStates[this.data.activeMode];
    if (!state || !state.task) return;
    if (this.data.activeMode === 1) {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        success: (res) => {
          const filePath = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath;
          if (!filePath) return;
          wx.showLoading({ title: '上传截图中', mask: true });
          const cloudPath = `help_proofs/${this.modeStateKey()}/${Date.now()}-${Math.floor(Math.random() * 1000000)}.jpg`;
          wx.cloud.uploadFile({
            cloudPath,
            filePath,
            success: (up) => this.doMarkSuccess(up.fileID),
            fail: () => {
              wx.hideLoading();
              Toast({ context: this, selector: '#t-toast', message: '截图上传失败，请重试' });
            }
          });
        },
        fail: () => { /* 用户取消选择 */ }
      });
      return;
    }
    this.doMarkSuccess('');
  },

  doMarkSuccess(proofFileId) {
    const state = this._modeStates[this.data.activeMode];
    if (!state || !state.task) return;
    const taskId = state.task.taskId;
    this.stopTaskTimer();
    // 提交后进入待核对：对方确认或 10 分钟自动通过才算完成
    this.notifyCommandStatus(taskId, 'submitted', proofFileId);

    this.updateMode({ task: null }, this.data.activeMode);
    this.setData({ taskCountdown: '' });
    this.loadCommands();
    Toast({ context: this, selector: '#t-toast', message: '已提交，等待对方核对' });
  },

  /** 受助方确认完成：待核对 → 已成功（受助次数此时才 +1） */
  confirmReceive(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.showLoading({ title: '确认中', mask: true });
    wx.cloud.callFunction({
      name: 'toolsManage',
      data: { action: 'confirmReceive', tool_key: this.modeStateKey(), task_id: id },
      success: (r) => {
        const result = r && r.result;
        if (result && result.success) {
          Toast({ context: this, selector: '#t-toast', message: '已确认完成', theme: 'success' });
          this.loadRecords();
          this.loadCommands();
        } else {
          Toast({ context: this, selector: '#t-toast', message: '确认失败，请重试' });
        }
      },
      fail: () => Toast({ context: this, selector: '#t-toast', message: '云端不可用，请稍后重试' }),
      complete: () => wx.hideLoading()
    });
  },

  /** 复制任务口令 */
  copyTaskCommand() {
    const state = this._modeStates[this.data.activeMode];
    const command = state && state.task && state.task.command;
    if (!command) return;
    wx.setClipboardData({
      data: command,
      success: () => Toast({ context: this, selector: '#t-toast', message: '口令已复制', theme: 'success' })
    });
  },

  /** 黑名单（按工具分组，本地存储） */
  getBlockList() {
    try {
      const all = wx.getStorageSync(BLOCK_KEY) || {};
      return all[this.modeStateKey()] || [];
    } catch (e) { return []; }
  },

  addBlockNick(nick) {
    if (!nick) return;
    try {
      const all = wx.getStorageSync(BLOCK_KEY) || {};
      const key = this.modeStateKey();
      const list = all[key] || [];
      if (list.indexOf(nick) === -1) list.push(nick);
      all[key] = list;
      wx.setStorageSync(BLOCK_KEY, all);
    } catch (e) { /* 忽略 */ }
  },

  /** 记录页：从云端拉取互助记录（助人/受助，跨天保留，最近 50 条） */
  loadRecords() {
    const mode = this.data.activeMode === 0 ? 'solo' : 'team';
    this.setData({ recordsLoading: true });
    wx.cloud.callFunction({
      name: 'toolsManage',
      data: {
        action: 'getRecords',
        tool_key: this.modeStateKey(),
        mode,
        type: this.data.recordType
      },
      success: (r) => {
        const result = r && r.result;
        if (!result || !result.success) {
          this.setData({ recordsLoading: false, recordsList: [] });
          return;
        }
        const STATUS_TEXT = { ongoing: '进行中', pending: '待核对', done: '已成功', returned: '已放回' };
        const filter = this.data.recordFilter;
        const all = (result.records || []).map((r) => ({
          id: r._id,
          nick: r.nick,
          command: r.command,
          date: r.date,
          time: (r.created_at || '').slice(11, 16),
          status: r.status,
          statusText: STATUS_TEXT[r.status] || r.status
        }));
        // 各状态计数（与筛选无关，始终基于全量）
        const recordCounts = {
          all: all.length,
          done: all.filter((r) => r.status === 'done').length,
          pending: all.filter((r) => r.status === 'pending').length,
          returned: all.filter((r) => r.status === 'returned').length,
          ongoing: all.filter((r) => r.status === 'ongoing').length
        };
        const list = all.filter((r) => filter === 'all' ? true : r.status === filter);
        // 按日期分组（新→旧），便于浏览历史
        const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        const groups = {};
        all.forEach((r) => {
          if (!groups[r.date]) groups[r.date] = [];
          groups[r.date].push(r);
        });
        const recordGroups = Object.keys(groups).sort().reverse().map((date) => {
          const d = new Date(date + 'T00:00:00+08:00');
          const thisYear = new Date().getFullYear() === d.getFullYear();
          const dateText = (thisYear ? '' : d.getFullYear() + '年')
            + (d.getMonth() + 1) + '月' + d.getDate() + '日 · ' + WEEK[d.getDay()];
          return { date, dateText, list: groups[date] };
        });
        this.setData({ recordsLoading: false, recordsList: list, recordGroups, recordCounts });
      },
      fail: () => {
        this.setData({ recordsLoading: false, recordsList: [] });
        Toast({ context: this, selector: '#t-toast', message: '记录加载失败，请重试' });
      }
    });
  },

  setRecordType(e) {
    const t = e.currentTarget.dataset.t;
    if (t === this.data.recordType) return;
    this.setData({ recordType: t, recordFilter: 'all' }, () => this.loadRecords());
  },

  setRecordFilter(e) {
    this.setData({ recordFilter: e.currentTarget.dataset.f }, () => this.loadRecords());
  },

  /** 查看记录详情：完整口令，可复制 */
  viewRecordDetail(e) {
    const id = e.currentTarget.dataset.id;
    const record = this.data.recordsList.find((r) => r.id === id);
    if (!record) return;
    Dialog.confirm({
      context: this,
      selector: '#t-dialog',
      title: '互助详情',
      content: [
        '对象：' + record.nick,
        '口令：' + (record.command || '未记录'),
        '时间：' + record.date + ' ' + (record.time || '')
      ].join('\n'),
      confirmBtn: '复制口令',
      cancelBtn: '关闭'
    }).then(() => {
      if (record.command) {
        wx.setClipboardData({
          data: record.command,
          success: () => Toast({ context: this, selector: '#t-toast', message: '口令已复制', theme: 'success' })
        });
      }
    }).catch(() => {});
  },

  /** 弹窗所属模式的状态（与看板 activeMode 解耦） */
  settingsState() {
    const index = this.data.settingsMode;
    return this._modeStates[index] || createModeState(index, this.data.tool);
  },

  /** 调整剩余受助人数：只影响弹窗所属模式 */
  adjustQuota() {
    const s = this.settingsState();
    const max = s.receiveLimit;
    wx.showModal({
      title: `${s.label} · 调整剩余受助人数`,
      editable: true,
      placeholderText: `请输入 1 ~ ${max}`,
      content: String(s.helpQuota),
      success: (res) => {
        if (!res.confirm) return;
        const n = parseInt(res.content, 10);
        if (isNaN(n) || n < 1 || n > max) {
          Toast({ context: this, selector: '#t-toast', message: `请输入 1 ~ ${max}` });
          return;
        }
        this.updateMode({ helpQuota: n });
        // 云端生效：受助名额按「本人设置」与「工具上限」较小值限制
        wx.cloud.callFunction({
          name: 'toolsManage',
          data: {
            action: 'setHelpQuota',
            tool_key: this.modeStateKey(),
            mode: this.data.settingsMode === 0 ? 'solo' : 'team',
            quota: n
          },
          fail: () => Toast({ context: this, selector: '#t-toast', message: '云端同步失败，稍后重试' })
        });
        Toast({ context: this, selector: '#t-toast', message: '已调整', theme: 'success' });
      }
    });
  },

  /** 暂停 / 恢复受助：本地 + 云端同步（暂停后口令不进入抽取池） */
  togglePause() {
    const paused = !this.settingsState().paused;
    this.updateMode({ paused });
    wx.cloud.callFunction({
      name: 'toolsManage',
      data: {
        action: 'setHelpPause',
        tool_key: this.modeStateKey(),
        mode: this.data.settingsMode === 0 ? 'solo' : 'team',
        paused
      },
      fail: () => Toast({ context: this, selector: '#t-toast', message: '云端同步失败，稍后自动重试' })
    });
    Toast({ context: this, selector: '#t-toast', message: paused ? '已暂停受助' : '已恢复受助' });
  },

  /** 清除登记资料：二次确认后删除云端资料与本地缓存 */
  clearProfile() {
    if (!this.data.account) {
      Toast({ context: this, selector: '#t-toast', message: '尚未登记资料' });
      return;
    }

    Dialog.confirm({
      context: this,
      selector: '#t-dialog',
      title: '清除登记资料',
      content: '将删除已登记的昵称与头像，并撤回邀请；未决任务和必要历史记录会保留。确定继续吗？',
      confirmBtn: '确认清除',
      cancelBtn: '取消'
    }).then(() => {
      this.doClearProfile();
    }).catch(() => {});
  },

  doClearProfile() {
    wx.showLoading({ title: '清除中', mask: true });
    wx.cloud.callFunction({
      name: 'toolsManage',
      data: { action: 'clearAccount' },
      success: (r) => {
        const result = r && r.result;
        if (result && result.success) {
          this.clearAccountLocal();
          Toast({ context: this, selector: '#t-toast', message: '资料已清除', theme: 'success' });
        } else {
          Toast({ context: this, selector: '#t-toast', message: '清除失败，请重试' });
        }
      },
      fail: () => {
        Toast({ context: this, selector: '#t-toast', message: '云端不可用，请稍后重试' });
      },
      complete: () => wx.hideLoading()
    });
  },

  clearAccountLocal() {
    const key = this.accountKey();
    try {
      const cached = wx.getStorageSync(ACCOUNT_CACHE_KEY) || {};
      Object.keys(cached).forEach(k => delete cached[k]);
      cached.version = ACCOUNT_CACHE_VERSION;
      wx.setStorageSync(ACCOUNT_CACHE_KEY, cached);
    } catch (e) { /* 忽略 */ }

    this._modeStates.forEach((s) => { s.command = ''; });
    this.setData({
      account: null,
      avatarText: '登',
      avatarPreview: '',
      showEdit: false,
      agreed: false,
      form: { tb_nick: '', avatar_url: '', avatarTemp: '' }
    });
    this.syncCurrent();
  },

  /** 车队助力模式：今日方式已锁定 */
  onLocked() {
    Toast({ context: this, selector: '#t-toast', message: '今日方式已锁定，明日可更改' });
  },

  /** 更新赛车等级：只影响弹窗所属模式 */
  updateCarLevel() {
    const s = this.settingsState();
    wx.showModal({
      title: `${s.label} · 更新赛车等级`,
      editable: true,
      placeholderText: '请输入当前等级（1~99）',
      content: String(s.carLevel),
      success: (res) => {
        if (!res.confirm) return;
        const n = parseInt(res.content, 10);
        if (isNaN(n) || n < 1 || n > 99) {
          Toast({ context: this, selector: '#t-toast', message: '请输入 1 ~ 99' });
          return;
        }
        this.updateMode({ carLevel: n });
        Toast({ context: this, selector: '#t-toast', message: '已更新', theme: 'success' });
      }
    });
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  }
});
