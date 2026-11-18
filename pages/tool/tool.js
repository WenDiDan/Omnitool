const Toast = require('tdesign-miniprogram/toast/index').default;
const Dialog = require('tdesign-miniprogram/dialog/index').default;
const toolsService = require('../../utils/tools.js');

const { createModeState } = require('./modules/mode-config.js');
const modeState = require('./modules/mode-state.js');
const records = require('./modules/records.js');
const account = require('./modules/account.js');
const helpSettings = require('./modules/help-settings.js');
const commandTask = require('./modules/command-task.js');

Page(Object.assign({}, modeState, records, account, helpSettings, commandTask, {
  data: {
    tool: null,
    ruleLines: [],
    loading: true,
    notFound: false,
    blocked: false, // 后台封禁：展示封禁提示并禁用互助操作
    blockedReason: '', // 封禁原因（云端下发，空则不显示）
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

  /** 从云端读取今天两个模式的口令 */
  loadCommands() {
    wx.cloud.callFunction({
      name: 'coinPkApi',
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

  onFeature(e) {
    const name = e.currentTarget.dataset.name || '该功能';
    Toast({ context: this, selector: '#t-toast', message: `${name}` });
  },

  // ===== 受助设置 =====
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
          name: 'coinPkApi',
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
      name: 'coinPkApi',
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
      name: 'coinPkApi',
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
    // 缓存键与版本号属于 account 模块私有常量，统一由该模块清理，避免跨模块引用
    this.clearAccountCache();

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
}));
