const toolsService = require('../../utils/tools.js');

// 前端统一图标底色色板：云端配置的杂色一律覆盖，保证首页暖色调统一
// 关键：内置图标全部是白色 PNG（icon_*_white.png），底色必须足够深，
// 否则白图标压在浅米底上等于看不见（旧色板 #F3E7D8 一类就是这个问题）。
// 这里统一用中深暖色，白图标与白色单字标记都能压住。
const ICON_PALETTE = ['#C0553D', '#C8952C', '#2F6C60', '#8A5B2C', '#B35A00'];
const FEATURED_ICON_BG = '#A8452F';

Page({
  data: {
    featuredTool: null,
    tools: [],
    toolCount: '00',
    // 三态：loading 加载中 / ready 正常 / empty 空 / error 错误
    loadState: 'loading',
    syncHint: ''
  },

  onLoad() {
    // 先用本地缓存/内置兜底立即渲染，避免首屏空白
    this.applyTools(toolsService.getCachedTools());
    this.refreshTools();
  },

  onShow() {
    // 切后台再回 / 从子页面返回时做版本比对：配置有变化自动刷新，无变化仅一次轻量请求
    this.syncVersionTick();
  },

  /** 版本比对一次：配置有变化时用云端结果走完整渲染（成功/空/失效状态都会被正确重置） */
  syncVersionTick() {
    if (this._syncing) return
    this._syncing = true
    toolsService.syncIfChanged().then((res) => {
      this._syncing = false
      if (res) this.renderToolsResult(res)
    }).catch(() => { this._syncing = false })
  },

  onPullDownRefresh() {
    this.refreshTools(true).then(() => wx.stopPullDownRefresh());
  },

  /** 从云端刷新工具清单 */
  refreshTools(force) {
    return toolsService.refreshTools(force)
      .then(res => this.renderToolsResult(res))
      .catch(() => {
        // 云端确认不可用：只展示可离线运行的内置工具，不回读缓存（缓存里可能残留线上工具）
        this.applyTools(toolsService.offlineTools());
        this.setData({ loadState: 'error', syncHint: '同步失败，显示本地清单' });
      });
  },

  /** 渲染一次刷新结果（onLoad/onShow 自动同步/下拉刷新/重试共用） */
  renderToolsResult(res) {
    if (res.success) {
      this.applyTools(res.tools);
      this.setData({ loadState: 'ready', syncHint: '' });
    } else if (res.source === 'empty') {
      // 云端确认无上线工具（管理员全部下线 / 集合为空）
      // 必须同时清空计数与卡片：否则缓存里的旧数量会残留成「02 个工具 + 暂无可用工具」
      this.applyTools([]);
      this.setData({ loadState: 'empty', syncHint: '' });
    } else {
      // 云端不可用时保留本地清单，仅提示，不白屏
      this.applyTools(res.tools);
      this.setData({
        loadState: 'error',
        syncHint: res.source === 'timeout' ? '同步超时，显示本地清单' : '云端不可用，显示本地清单'
      });
    }
  },

  /** 点击状态条上的重试 */
  onRetry() {
    this.setData({ loadState: 'loading', syncHint: '' });
    this.refreshTools(true);
  },

  /** 把工具清单拆成主推卡 + 其余网格，编号自动推导 */
  applyTools(list) {
    // decode 已彻底并入 scan：云端/内置清单只有一条「扫一扫 · 解码」
    // 防御：若历史数据仍含 decode 记录，此处静默剔除
    const tools = (Array.isArray(list) ? list : []).filter(t => t.tool_key !== 'decode');
    if (!tools.length) {
      this.setData({ featuredTool: null, tools: [], toolCount: '00' });
      return;
    }

    // 主推卡选择：
    // ① scan 在线且标记主推 → 固定「扫一扫 · 解码」双入口卡（历史行为）
    // ② 否则尊重云端 featured 标记；全部未标记时不兜底 tools[0]，全部平铺进网格
    //    （后台关闭所有主推位 → 首页不再出现大卡）
    const scanTool = tools.find(t => t.tool_key === 'scan')
    let featured = null
    if (scanTool && scanTool.featured) {
      featured = scanTool
      featured.name = '扫一扫 · 解码'
      featured.desc = '相机扫码 / 相册识别 · 内容解析与编码转换'
      featured.navUrl = '/pages/scan/scan'
      featured.navType = 'navigateTo'
    } else {
      featured = tools.find(t => t.featured) || null
      if (featured) featured.navUrl = featured.url || ''
    }
    let rest = tools.filter(t => t !== featured);

    if (featured) {
      featured.iconBg = FEATURED_ICON_BG;
      featured.mark = (featured.name || '').slice(0, 1);
    }
    rest = rest.map((t, i) => {
      const isRegCode = t.tool_key === 'regcode';
      return {
        ...t,
        no: String(i + (featured ? 2 : 1)).padStart(2, '0'),
        // 注册码固定使用设置图标（云端旧数据兼容）
        icon: isRegCode ? '/images/nav_settings_white.png' : t.icon,
        iconBg: ICON_PALETTE[i % ICON_PALETTE.length],
        // 深色底上单字标记一律用白色，覆盖云端可能配置的深色 badgeColor
        badgeColor: '#FFFFFF',
        // 无图标时用工具名首字兜底，避免出现空白方块
        mark: (t.name || '').slice(0, 1)
      };
    });

    const count = (featured ? 1 : 0) + rest.length;
    this.setData({
      featuredTool: featured,
      tools: rest,
      toolCount: String(count).padStart(2, '0')
    });
  },

  /** 统一跳转：本地路由表优先（云端的 url 仅兜底），navType 决定跳转方式 */
  onToolTap(e) {
    const { url, navtype, toolkey } = e.currentTarget.dataset;

    // 互助类工具：进入通用工具详情页（规则由云端配置渲染）
    if (navtype === 'tool') {
      wx.navigateTo({ url: `/pages/tool/tool?key=${toolkey || ''}` });
      return;
    }

    const target = toolsService.resolveRoute(toolkey, url);
    if (!target) {
      wx.showToast({ title: '该工具暂未配置入口', icon: 'none' });
      return;
    }

    const fail = (err) => wx.showToast({
      title: `跳转失败：${(err && err.errMsg) || target}`,
      icon: 'none',
      duration: 3000
    });

    if (navtype === 'switchTab') {
      wx.switchTab({ url: target, fail: () => wx.navigateTo({ url: target, fail }) });
    } else {
      wx.navigateTo({ url: target, fail });
    }
  }
});
