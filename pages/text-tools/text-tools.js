/**
 * 文本工具箱
 * 结构：功能动作表（ACTIONS）驱动按钮网格，输入即出结果
 * 新增处理功能只需在 ACTIONS 加一项并在 applyAction 里加对应分支
 */
const ACTIONS = [
  { key: 'trim', name: '去首尾空格' },
  { key: 'removeEmpty', name: '去除空行' },
  { key: 'dedupe', name: '去除重复行' },
  { key: 'sortLines', name: '行排序' },
  { key: 'shuffleLines', name: '行序打散' },
  { key: 'reverseLines', name: '行序反转' },
  { key: 'upper', name: '转大写' },
  { key: 'lower', name: '转小写' },
  { key: 'cn2en', name: '中→英标点' },
  { key: 'en2cn', name: '英→中标点' }
]

/** 中英标点映射（中→英） */
const PUNCT_MAP_CN2EN = {
  '，': ', ', '。': '. ', '、': ', ', '；': '; ', '：': ': ',
  '？': '? ', '！': '! ', '（': ' (', '）': ') ',
  '“': '"', '”': '"', '‘': "'", '’': "'",
  '【': '[', '】': ']', '《': '"', '》': '"'
}

function cn2en(str) {
  return str.replace(/[，。、；：？！（）”“’‘【】《》]/g, ch => PUNCT_MAP_CN2EN[ch] || ch)
}

const PUNCT_MAP_EN2CN = {
  ',': '，', '.': '。', ';': '；', ':': '：',
  '?': '？', '!': '！', '(': '（', ')': '）',
  '[': '【', ']': '】'
}

function en2cn(str) {
  // 成对引号交替替换为“ ”
  let quoteOpen = true
  const result = str.replace(/["']/g, () => {
    const ch = quoteOpen ? '“' : '”'
    quoteOpen = !quoteOpen
    return ch
  })
  return result.replace(/[,.;:?!()\[\]]/g, ch => PUNCT_MAP_EN2CN[ch] || ch)
}

/** Fisher-Yates 洗牌 */
function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = a[i]; a[i] = a[j]; a[j] = t
  }
  return a
}

/** UTF-8 字节数 */
function utf8Bytes(str) {
  let bytes = 0
  for (let i = 0; i < str.length; i++) {
    const code = str.codePointAt(i)
    if (code > 0xFFFF) i++ // 代理对占两位，跳过后半个
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }
  return bytes
}

Page({
  data: {
    actions: ACTIONS,
    input: '',
    result: '',
    hasResult: false,
    statChars: 0,
    statNoSpace: 0,
    statLines: 0,
    statBytes: 0,
    findText: '',
    replaceText: ''
  },

  onInput(e) {
    this.setData({ input: e.detail.value, hasResult: false, result: '' })
    this.updateStats(e.detail.value)
  },

  updateStats(text) {
    const chars = text.length
    const noSpace = text.replace(/\s/g, '').length
    const lines = text ? text.split('\n').length : 0
    this.setData({
      statChars: chars,
      statNoSpace: noSpace,
      statLines: lines,
      statBytes: utf8Bytes(text)
    })
  },

  onFindInput(e) { this.setData({ findText: e.detail.value }) },
  onReplaceInput(e) { this.setData({ replaceText: e.detail.value }) },

  doReplace() {
    const { input, findText, replaceText } = this.data
    if (!input) return this.toastInputFirst()
    if (!findText) return wx.showToast({ title: '请输入查找内容', icon: 'none' })
    this.showResult(input.split(findText).join(replaceText))
  },

  onActionTap(e) {
    if (!this.data.input) return this.toastInputFirst()
    this.showResult(this.applyAction(e.currentTarget.dataset.key, this.data.input))
  },

  applyAction(key, text) {
    switch (key) {
      case 'trim': return text.split('\n').map(l => l.trim()).join('\n').trim()
      case 'removeEmpty': return text.split('\n').filter(l => l.trim() !== '').join('\n')
      case 'dedupe': {
        const seen = new Set()
        return text.split('\n').filter(l => {
          const k = l.trim()
          if (seen.has(k)) return false
          seen.add(k)
          return true
        }).join('\n')
      }
      case 'sortLines': return text.split('\n').sort((a, b) => a.localeCompare(b)).join('\n')
      case 'shuffleLines': return shuffle(text.split('\n')).join('\n')
      case 'reverseLines': return text.split('\n').reverse().join('\n')
      case 'upper': return text.toUpperCase()
      case 'lower': return text.toLowerCase()
      case 'cn2en': return cn2en(text)
      case 'en2cn': return en2cn(text)
      default: return text
    }
  },

  showResult(text) {
    this.setData({ result: text, hasResult: true })
  },

  toastInputFirst() {
    wx.showToast({ title: '请先输入文本', icon: 'none' })
  },

  pasteInput() {
    wx.getClipboardData({
      success: (res) => {
        const text = res.data || ''
        this.setData({ input: text })
        this.updateStats(text)
      },
      fail: () => wx.showToast({ title: '读取剪贴板失败', icon: 'none' })
    })
  },

  clearInput() {
    this.setData({ input: '', result: '', hasResult: false, statChars: 0, statNoSpace: 0, statLines: 0, statBytes: 0 })
  },

  copyResult() {
    if (!this.data.hasResult) return
    wx.setClipboardData({
      data: this.data.result,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    })
  }
})
