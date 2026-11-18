/**
 * history 页面单元测试
 *
 * 测试范围：
 * - getTypeLabel()  类型标签映射（7个分支 + 边界）
 * - loadHistory()   加载全局历史记录
 * - clearHistory()  清空确认流程
 * - viewDetail()    查看详情并跳转
 * - goToScan()      跳转到扫码页
 */

// --------------- mock setup ---------------

// 必须在 require 页面文件之前 mock，因为 Page() 在模块顶层执行
const mockWx = {
  showModal: jest.fn(),
  showToast: jest.fn(),
  switchTab: jest.fn(),
  navigateTo: jest.fn(),
  setClipboardData: jest.fn(),
  // permission.js 读写缓存依赖这两个 API
  getStorageSync: jest.fn(() => null),
  setStorageSync: jest.fn(),
  // 清空历史前会先上云存档到回收站
  cloud: {
    callFunction: jest.fn(() => Promise.resolve({ result: { success: true } }))
  }
};

const mockApp = {
  globalData: {
    scanHistory: [],
    pendingScanCode: null
  },
  clearScanHistory: jest.fn()
};

let pageDefinition = null;

// 捕获 Page() 传入的定义对象
global.Page = jest.fn((def) => { pageDefinition = def; });
global.getApp = jest.fn(() => mockApp);
global.wx = mockWx;

// --------------- require 页面（触发 Page 注册）---------------
require('../pages/scan/history/history.js');

// --------------- helpers ---------------

/** 构造一条模拟历史记录 */
function makeHistoryItem(overrides = {}) {
  return {
    code: '6901234567890',
    type: 'EAN_13',
    time: '2025-01-01 12:00:00',
    count: 1,
    wxScanType: 'EAN_13',
    decodedInfo: null,
    timestamp: Date.now(),
    ...overrides
  };
}

/** 模拟 setData 环境 */
function setupPageContext(dataOverrides = {}) {
  const data = { historyList: [], ...dataOverrides };
  const ctx = { data, setData: jest.fn((newData) => Object.assign(ctx.data, newData)) };
  // 绑定方法到模拟上下文
  Object.keys(pageDefinition).forEach((key) => {
    if (typeof pageDefinition[key] === 'function') {
      ctx[key] = pageDefinition[key] || (() => {});
    }
  });
  return ctx;
}

// --------------- 每轮重置 ---------------

beforeEach(() => {
  jest.clearAllMocks();
  mockApp.globalData.scanHistory = [];
  mockApp.globalData.pendingScanCode = null;
});

/* ===================================================================
   getTypeLabel()  — 已抽至 pages/scan/utils/scan-utils.js，按公共工具测试
   =================================================================== */

describe('getTypeLabel(type)', () => {
  let getTypeLabel;

  beforeAll(() => {
    getTypeLabel = require('../pages/scan/utils/scan-utils.js').getTypeLabel;
  });

  /* ---- EAN 分支 ---- */
  describe('EAN 分支', () => {
    const eanInputs = ['EAN_13', 'EAN_8', 'ean', '条形码', 'barcode', 'isbn', 'UPC'];

    eanInputs.forEach((input) => {
      it(`"${input}" → 'EAN'`, () => {
        expect(getTypeLabel(input)).toBe('EAN');
      });
    });

    it('混合大小写包含 ean → EAN', () => {
      expect(getTypeLabel('some-EaN-type')).toBe('EAN');
    });
  });

  /* ---- QR 分支 ---- */
  describe('QR 分支', () => {
    it('"qr" → QR', () => { expect(getTypeLabel('qr')).toBe('QR'); });
    it('"QR_CODE" → QR', () => { expect(getTypeLabel('QR_CODE')).toBe('QR'); });
    it('"二维码" → QR', () => { expect(getTypeLabel('二维码')).toBe('QR'); });
    it('包含 qr → QR', () => { expect(getTypeLabel('type-qr-v2')).toBe('QR'); });
  });

  /* ---- URL 分支 ---- */
  describe('URL 分支', () => {
    it('"url" → URL', () => { expect(getTypeLabel('url')).toBe('URL'); });
    it('"http" → URL', () => { expect(getTypeLabel('http')).toBe('URL'); });
    it('"网址" → URL', () => { expect(getTypeLabel('网址')).toBe('URL'); });
  });

  /* ---- WiFi 分支 ---- */
  describe('WiFi 分支', () => {
    it('"wifi" → WiFi', () => { expect(getTypeLabel('wifi')).toBe('WiFi'); });
    it('"WIFI" → WiFi', () => { expect(getTypeLabel('WIFI')).toBe('WiFi'); });
  });

  /* ---- Card 分支 ---- */
  describe('Card 分支', () => {
    it('"vcard" → Card', () => { expect(getTypeLabel('vcard')).toBe('Card'); });
    it('"联系人" → Card', () => { expect(getTypeLabel('联系人')).toBe('Card'); });
  });

  /* ---- TEL 分支 ---- */
  describe('TEL 分支', () => {
    it('"tel" → TEL', () => { expect(getTypeLabel('tel')).toBe('TEL'); });
    it('"电话" → TEL', () => { expect(getTypeLabel('电话')).toBe('TEL'); });
  });

  /* ---- 回退分支 ---- */
  describe('回退（fallback）', () => {
    it('未知类型取前3字符大写', () => {
      expect(getTypeLabel('ABC')).toBe('ABC');
      expect(getTypeLabel('hello')).toBe('HEL');
      expect(getTypeLabel('DATA_MATRIX')).toBe('DAT');
    });

    it('短于3字符截取全部', () => {
      expect(getTypeLabel('xy')).toBe('XY');
      expect(getTypeLabel('x')).toBe('X');
    });
  });

  /* ---- 边界 & 异常 ---- */
  describe('边界 & 异常', () => {
    it('空字符串 → "?"  ', () => {
      expect(getTypeLabel('')).toBe('?');
    });

    it('null / undefined → "?"', () => {
      expect(getTypeLabel(null)).toBe('?');
      expect(getTypeLabel(undefined)).toBe('?');
    });

    it('纯数字（无匹配）→ 前3字符', () => {
      expect(getTypeLabel('CODE_39')).toBe('COD');
    });
  });
});

/* ===================================================================
   loadHistory()
   =================================================================== */

describe('loadHistory()', () => {
  it('从 app.globalData.scanHistory 读取并设置 typeLabel', () => {
    mockApp.globalData.scanHistory = [
      makeHistoryItem({ code: 'A', type: 'QR_CODE' }),
      makeHistoryItem({ code: 'B', type: 'ean_13' }),
      makeHistoryItem({ code: 'C', type: 'wifi' })
    ];
    const ctx = setupPageContext();

    pageDefinition.loadHistory.call(ctx);

    expect(ctx.setData).toHaveBeenCalledTimes(1);
    const list = ctx.setData.mock.calls[0][0].historyList;
    expect(list).toHaveLength(3);
    expect(list[0].typeLabel).toBe('QR');
    expect(list[1].typeLabel).toBe('EAN');
    expect(list[2].typeLabel).toBe('WiFi');
    // 原始字段保留
    expect(list[0].code).toBe('A');
    expect(list[0].type).toBe('QR_CODE');
  });

  it('空历史 → historyList 为空数组', () => {
    mockApp.globalData.scanHistory = [];
    const ctx = setupPageContext();

    pageDefinition.loadHistory.call(ctx);

    expect(ctx.setData.mock.calls[0][0]).toEqual(expect.objectContaining({ historyList: [] }));
  });

  it('scanHistory 不存在 → 安全降级为空数组', () => {
    mockApp.globalData.scanHistory = null;
    const ctx = setupPageContext();

    pageDefinition.loadHistory.call(ctx);

    expect(ctx.setData.mock.calls[0][0]).toEqual(expect.objectContaining({ historyList: [] }));
  });

  it('记录超过一页时只渲染首屏，并标记还有更多', () => {
    mockApp.globalData.scanHistory = Array.from({ length: 65 }, (_, i) =>
      makeHistoryItem({ code: 'C' + i, time: '2025-01-01 12:00:00' })
    );
    const ctx = setupPageContext();

    pageDefinition.loadHistory.call(ctx);

    const patch = ctx.setData.mock.calls[0][0];
    expect(patch.historyList).toHaveLength(65);
    expect(patch.visibleList).toHaveLength(30);
    expect(patch.hasMore).toBe(true);
  });

  it('触底加载按页追加，全部加载后 hasMore 为 false', () => {
    mockApp.globalData.scanHistory = Array.from({ length: 65 }, (_, i) =>
      makeHistoryItem({ code: 'C' + i })
    );
    const ctx = setupPageContext();
    pageDefinition.loadHistory.call(ctx);
    Object.assign(ctx.data, ctx.setData.mock.calls[0][0]);

    pageDefinition.onReachBottom.call(ctx);
    expect(ctx.data.visibleList).toHaveLength(60);
    expect(ctx.data.hasMore).toBe(true);

    pageDefinition.onReachBottom.call(ctx);
    expect(ctx.data.visibleList).toHaveLength(65);
    expect(ctx.data.hasMore).toBe(false);

    // 已无更多时不再触发 setData
    const calls = ctx.setData.mock.calls.length;
    pageDefinition.onReachBottom.call(ctx);
    expect(ctx.setData.mock.calls.length).toBe(calls);
  });
});

/* ===================================================================
   clearHistory()
   =================================================================== */

describe('clearHistory()', () => {
  it('调用 wx.showModal 弹出确认框', () => {
    const ctx = setupPageContext();

    pageDefinition.clearHistory.call(ctx);

    expect(mockWx.showModal).toHaveBeenCalledTimes(1);
    expect(mockWx.showModal.mock.calls[0][0].title).toBe('确认清空');
    expect(mockWx.showModal.mock.calls[0][0].content).toContain('清空所有');
  });

  it('用户确认 → 先上云存档，再调用 clearScanHistory + toast', async () => {
    const ctx = setupPageContext();
    mockWx.showModal.mockImplementation(({ success }) => success({ confirm: true }));

    pageDefinition.clearHistory.call(ctx);
    // 清空是异步流程（先存云端回收站再清理本地）
    await new Promise((r) => setTimeout(r, 0));

    expect(mockApp.clearScanHistory).toHaveBeenCalledTimes(1);
    expect(mockWx.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining('已清空') })
    );
  });

  it('用户取消 → 不做任何清理', () => {
    const ctx = setupPageContext();
    mockWx.showModal.mockImplementation(({ success }) => success({ confirm: false }));

    pageDefinition.clearHistory.call(ctx);

    expect(mockApp.clearScanHistory).not.toHaveBeenCalled();
    expect(mockWx.showToast).not.toHaveBeenCalled();
  });
});

/* ===================================================================
   viewDetail(e)
   =================================================================== */

describe('viewDetail(e)', () => {
  it('打开页内详情弹层并带入扫码数据', () => {
    const ctx = setupPageContext();
    mockApp.globalData.scanHistory = [makeHistoryItem({ code: 'https://example.com', type: 'URL' })];
    const e = { currentTarget: { dataset: { code: 'https://example.com' } } };

    pageDefinition.viewDetail.call(ctx, e);

    expect(ctx.data.showDetail).toBe(true);
    expect(ctx.data.scanResult.code).toBe('https://example.com');
    expect(mockWx.switchTab).not.toHaveBeenCalled();
  });

  it('code 为空字符串也可正常处理', () => {
    const ctx = setupPageContext();
    const e = { currentTarget: { dataset: { code: '' } } };

    pageDefinition.viewDetail.call(ctx, e);

    expect(ctx.data.showDetail).toBe(true);
    expect(ctx.data.scanResult.code).toBe('');
  });
});

/* ===================================================================
   goToScan()
   =================================================================== */

describe('goToScan()', () => {
  it('跳转到 scan 页', () => {
    const ctx = setupPageContext();

    pageDefinition.goToScan.call(ctx);

    expect(mockWx.navigateTo).toHaveBeenCalledWith({ url: '/pages/scan/scan' });
  });
});

/* ===================================================================
   onShow()
   =================================================================== */

describe('onShow()', () => {
  it('每次显示时重新加载历史', () => {
    const ctx = setupPageContext();
    mockApp.globalData.scanHistory = [
      makeHistoryItem({ code: 'X', type: 'QR_CODE' })
    ];

    pageDefinition.onShow.call(ctx);

    expect(ctx.setData).toHaveBeenCalled();
    const list = ctx.setData.mock.calls[0][0].historyList;
    expect(list).toHaveLength(1);
    expect(list[0].code).toBe('X');
  });
});
