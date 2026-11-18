/**
 * 单位换算
 * 结构：分类（categories）+ 每类单位表（factor 以基准单位归一）+ 温度特殊换算
 * 新增类别只需在 CATEGORIES 里加一项，页面无需改动
 */
const CATEGORIES = [
  {
    key: 'length',
    name: '长度',
    base: '米',
    units: [
      { key: 'mm', name: '毫米', factor: 0.001 },
      { key: 'cm', name: '厘米', factor: 0.01 },
      { key: 'm', name: '米', factor: 1 },
      { key: 'km', name: '千米', factor: 1000 },
      { key: 'in', name: '英寸', factor: 0.0254 },
      { key: 'ft', name: '英尺', factor: 0.3048 },
      { key: 'mi', name: '英里', factor: 1609.344 },
      { key: 'li', name: '里', factor: 500 }
    ]
  },
  {
    key: 'weight',
    name: '重量',
    base: '千克',
    units: [
      { key: 'mg', name: '毫克', factor: 0.000001 },
      { key: 'g', name: '克', factor: 0.001 },
      { key: 'kg', name: '千克', factor: 1 },
      { key: 't', name: '吨', factor: 1000 },
      { key: 'jin', name: '斤', factor: 0.5 },
      { key: 'lb', name: '磅', factor: 0.45359237 },
      { key: 'oz', name: '盎司', factor: 0.028349523125 }
    ]
  },
  {
    key: 'area',
    name: '面积',
    base: '平方米',
    units: [
      { key: 'cm2', name: '平方厘米', factor: 0.0001 },
      { key: 'm2', name: '平方米', factor: 1 },
      { key: 'km2', name: '平方千米', factor: 1000000 },
      { key: 'mu', name: '亩', factor: 666.6666667 },
      { key: 'ha', name: '公顷', factor: 10000 },
      { key: 'ft2', name: '平方英尺', factor: 0.09290304 }
    ]
  },
  {
    key: 'volume',
    name: '体积',
    base: '升',
    units: [
      { key: 'ml', name: '毫升', factor: 0.001 },
      { key: 'l', name: '升', factor: 1 },
      { key: 'm3', name: '立方米', factor: 1000 },
      { key: 'gal', name: '加仑(美)', factor: 3.785411784 },
      { key: 'qt', name: '夸脱(美)', factor: 0.946352946 }
    ]
  },
  {
    key: 'speed',
    name: '速度',
    base: '米/秒',
    units: [
      { key: 'kmh', name: '千米/小时', factor: 1 / 3.6 },
      { key: 'ms', name: '米/秒', factor: 1 },
      { key: 'mph', name: '英里/小时', factor: 0.44704 },
      { key: 'kn', name: '节', factor: 0.514444 }
    ]
  },
  {
    key: 'data',
    name: '数据',
    base: '字节',
    units: [
      { key: 'bit', name: 'bit', factor: 0.125 },
      { key: 'B', name: 'Byte', factor: 1 },
      { key: 'KB', name: 'KB', factor: 1024 },
      { key: 'MB', name: 'MB', factor: 1048576 },
      { key: 'GB', name: 'GB', factor: 1073741824 },
      { key: 'TB', name: 'TB', factor: 1099511627776 }
    ]
  },
  {
    key: 'temp',
    name: '温度',
    base: '摄氏度',
    special: true,
    units: [
      { key: 'C', name: '摄氏度(°C)' },
      { key: 'F', name: '华氏度(°F)' },
      { key: 'K', name: '开尔文(K)' }
    ]
  }
]

/** 温度换算：统一先转到摄氏度，再转到目标单位 */
function convertTemp(value, from, to) {
  let c
  if (from === 'C') c = value
  else if (from === 'F') c = (value - 32) * 5 / 9
  else c = value - 273.15
  if (to === 'C') return c
  if (to === 'F') return c * 9 / 5 + 32
  return c + 273.15
}

/** 格式化结果：保留最多 6 位有效小数，去掉多余的 0 */
function formatNum(n) {
  if (!isFinite(n)) return '—'
  const rounded = Math.round(n * 1e6) / 1e6
  return String(rounded)
}

Page({
  data: {
    categories: CATEGORIES.map(c => ({ key: c.key, name: c.name })),
    activeKey: 'length',
    units: [],
    unitNames: [],
    fromIndex: 2,
    toIndex: 0,
    inputValue: '',
    result: ''
  },

  onLoad() {
    this.applyCategory('length')
  },

  /** 切换类别并重置为该类默认单位组合 */
  applyCategory(key) {
    const cat = CATEGORIES.find(c => c.key === key) || CATEGORIES[0]
    const unitNames = cat.units.map(u => u.name)
    this.setData({
      activeKey: cat.key,
      units: cat.units,
      unitNames,
      fromIndex: Math.min(2, cat.units.length - 1),
      toIndex: 0,
      result: ''
    })
    this.convert()
  },

  onCategoryTap(e) {
    const key = e.currentTarget.dataset.key
    if (key !== this.data.activeKey) this.applyCategory(key)
  },

  onInput(e) {
    this.setData({ inputValue: e.detail.value })
    this.convert()
  },

  onFromChange(e) {
    this.setData({ fromIndex: Number(e.detail.value) })
    this.convert()
  },

  onToChange(e) {
    this.setData({ toIndex: Number(e.detail.value) })
    this.convert()
  },

  /** 交换单位方向 */
  swap() {
    this.setData({ fromIndex: this.data.toIndex, toIndex: this.data.fromIndex })
    this.convert()
  },

  convert() {
    const { units, fromIndex, toIndex, inputValue } = this.data
    const cat = CATEGORIES.find(c => c.key === this.data.activeKey)
    const value = parseFloat(inputValue)
    if (isNaN(value)) {
      this.setData({ result: '' })
      return
    }
    let out
    if (cat.special) {
      out = convertTemp(value, units[fromIndex].key, units[toIndex].key)
    } else {
      out = value * units[fromIndex].factor / units[toIndex].factor
    }
    this.setData({ result: formatNum(out) })
  },

  copyResult() {
    if (!this.data.result) return
    wx.setClipboardData({
      data: this.data.result,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    })
  }
})
