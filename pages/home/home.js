const toolsService = require('../../utils/tools.js');

// 前端统一图标底色色板：云端配置的杂色一律覆盖，保证首页暖赤陶色调统一
const ICON_PALETTE = ['#F3E7D8', '#EAF0FB', '#F7EDE2', '#F1E9F7', '#FDEFEA'];
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

  onPullDownRefresh() {
    this.refreshTools(true).then(() => wx.stopPullDownRefresh());
  },

  /** 从云端刷新工具清单 */
  refreshTools(force) {
    return toolsService.refreshTools(force).then((res) => {
      if (res.success) {
        this.applyTools(res.tools);
        this.setData({ loadState: 'ready', syncHint: '' });
      } else if (res.source === 'empty') {
        this.setData({ loadState: 'empty', syncHint: '云端暂无工具' });
      } else {
        // 云端不可用时保留本地清单，仅提示，不白屏
        this.applyTools(res.tools);
        this.setData({
          loadState: 'error',
          syncHint: res.source === 'timeout' ? '同步超时，显示本地清单' : '云端不可用，显示本地清单'
        });
      }
    }).catch(() => {
      this.applyTools(toolsService.getCachedTools());
      this.setData({ loadState: 'error', syncHint: '同步失败，显示本地清单' });
    });
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

    const featured = tools.find(t => t.tool_key === 'scan') ||
                     tools.find(t => t.featured) || tools[0];
    let rest = tools.filter(t => t !== featured);

    if (featured) {
      // 双入口固定指向扫码容器页（容器页内含页内导航）
      featured.name = '扫一扫 · 解码';
      featured.desc = '相机扫码 / 相册识别 · 内容解析与编码转换';
      featured.entries = [
        { name: '扫一扫', url: '/pages/scan/scan', navType: 'navigateTo', toolKey: 'scan' },
        { name: '解码', url: '/pages/scan/scan?tab=decode', navType: 'navigateTo', toolKey: 'decode' }
      ];
    }

    if (featured) featured.iconBg = FEATURED_ICON_BG;
    rest = rest.map((t, i) => {
      const isRegCode = t.tool_key === 'regcode';
      return {
        ...t,
        no: String(i + 2).padStart(2, '0'),
        // 注册码固定使用深绿齿轮图标（云端旧数据兼容）
        icon: isRegCode ? '/images/icon_settings_white.png' : t.icon,
        iconBg: isRegCode ? '#A8452F' : ICON_PALETTE[i % ICON_PALETTE.length]
      };
    });

    const count = (featured ? 1 : 0) + rest.length;
    this.setData({
      featuredTool: featured,
      tools: rest,
      toolCount: String(count).padStart(2, '0')
    });
  },

  /** 统一跳转：由云端配置的 url / navType 决定 */
  onToolTap(e) {
    const { url, navtype, toolkey } = e.currentTarget.dataset;

    // 互助类工具：进入通用工具详情页（规则由云端配置渲染）
    if (navtype === 'tool') {
      wx.navigateTo({ url: `/pages/tool/tool?key=${toolkey || ''}` });
      return;
    }

    if (!url) return;
    if (navtype === 'switchTab') {
      wx.switchTab({
        url,
        fail: () => wx.navigateTo({ url })
      });
    } else {
      wx.navigateTo({ url });
    }
  }
});
