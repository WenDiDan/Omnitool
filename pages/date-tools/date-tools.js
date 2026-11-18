/**
 * 日期工具
 * 结构：四个模式（日期间隔 / 日期推算 / 时间戳 / 倒计时）
 * 全部本地计算，无网络请求
 */
const WEEK_NAMES = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
const DAY_MS = 24 * 60 * 60 * 1000

const pad = n => String(n).padStart(2, '0')

function fmtDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function fmtDateTime(d) {
  return `${fmtDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 解析 YYYY-MM-DD 为当天 00:00 的 Date（避免时区解析差异） */
function parseDate(str) {
  if (!str) return null
  const parts = str.split('-').map(Number)
  if (parts.length !== 3 || parts.some(isNaN)) return null
  return new Date(parts[0], parts[1] - 1, parts[2])
}

/** 两个日期之间的天数差（b - a，整天） */
function dayDiff(a, b) {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS)
}

/**
 * 区间内工作日数量（含首尾，周一至周五，不含法定节假日调休）
 * 任意连续 7 天恰有 5 个工作日，先按整周估算再补余数，避免大区间逐日循环
 */
function countWorkdays(start, end) {
  const total = dayDiff(start, end) + 1
  if (total <= 0) return 0
  const fullWeeks = Math.floor(total / 7)
  let count = fullWeeks * 5
  const cur = new Date(start.getTime() + fullWeeks * 7 * DAY_MS)
  while (cur <= end) {
    const day = cur.getDay()
    if (day !== 0 && day !== 6) count++
    cur.setDate(cur.getDate() + 1)
  }
  return count
}

Page({
  data: {
    mode: 'diff',

    // 日期间隔
    startDate: '',
    endDate: '',
    diffDays: 0,
    diffDaysInclusive: 0,
    diffWorkdays: 0,
    diffWeeks: '',
    diffReverse: false,

    // 日期推算
    baseDate: '',
    offsetDays: '30',
    offsetWorkdays: false,
    calcDate: '',
    calcWeekday: '',

    // 时间戳
    nowTs: '',
    nowTsText: '',
    tsInput: '',
    tsDate: '',
    dateForTs: '',
    timeForTs: '00:00',
    dateTsResult: '',

    // 倒计时
    targetDate: '',
    targetTime: '00:00',
    cdDays: '0',
    cdHours: '00',
    cdMins: '00',
    cdSecs: '00',
    cdRunning: false
  },

  onLoad() {
    const today = fmtDate(new Date())
    const tomorrow = fmtDate(new Date(Date.now() + DAY_MS))
    this.setData({
      startDate: today,
      endDate: today,
      baseDate: today,
      dateForTs: today,
      targetDate: tomorrow
    }, () => {
      this.calcDiff()
      this.calcDate()
      this.refreshNow()
      this.calcDateToTs()
    })
  },

  onShow() {
    if (this.data.mode === 'timestamp') this.refreshNow()
  },

  onHide() {
    this.stopCountdown()
  },

  onUnload() {
    this.stopCountdown()
  },

  switchMode(e) {
    const mode = e.currentTarget.dataset.mode
    if (mode === this.data.mode) return
    this.setData({ mode })
    if (mode !== 'countdown') this.stopCountdown()
    if (mode === 'timestamp') this.refreshNow()
  },

  // ===== 日期间隔 =====
  onStartDate(e) {
    this.setData({ startDate: e.detail.value }, () => this.calcDiff())
  },

  onEndDate(e) {
    this.setData({ endDate: e.detail.value }, () => this.calcDiff())
  },

  calcDiff() {
    const a = parseDate(this.data.startDate)
    const b = parseDate(this.data.endDate)
    if (!a || !b) return
    const reverse = b < a
    const from = reverse ? b : a
    const to = reverse ? a : b
    const days = dayDiff(from, to)
    this.setData({
      diffReverse: reverse,
      diffDays: days,
      diffDaysInclusive: days + 1,
      diffWorkdays: countWorkdays(from, to),
      diffWeeks: (days / 7).toFixed(1)
    })
  },

  // ===== 日期推算 =====
  onBaseDate(e) {
    this.setData({ baseDate: e.detail.value }, () => this.calcDate())
  },

  onOffsetInput(e) {
    this.setData({ offsetDays: e.detail.value }, () => this.calcDate())
  },

  toggleWorkdays() {
    this.setData({ offsetWorkdays: !this.data.offsetWorkdays }, () => this.calcDate())
  },

  calcDate() {
    const base = parseDate(this.data.baseDate)
    const offset = parseInt(this.data.offsetDays, 10)
    if (!base || isNaN(offset)) {
      this.setData({ calcDate: '', calcWeekday: '' })
      return
    }

    let result
    if (this.data.offsetWorkdays) {
      // 工作日推算：正负方向逐日推进，跳过周末
      result = new Date(base.getTime())
      let remain = Math.abs(offset)
      const step = offset >= 0 ? 1 : -1
      while (remain > 0) {
        result.setDate(result.getDate() + step)
        const day = result.getDay()
        if (day !== 0 && day !== 6) remain--
      }
    } else {
      result = new Date(base.getTime() + offset * DAY_MS)
    }

    this.setData({
      calcDate: fmtDate(result),
      calcWeekday: WEEK_NAMES[result.getDay()]
    })
  },

  // ===== 时间戳 =====
  refreshNow() {
    const now = new Date()
    this.setData({ nowTs: String(now.getTime()), nowTsText: fmtDateTime(now) })
  },

  onTsInput(e) {
    const raw = e.detail.value.trim()
    this.setData({ tsInput: raw })
    if (!raw) return this.setData({ tsDate: '' })
    if (!/^\d+$/.test(raw)) {
      this.setData({ tsDate: '请输入纯数字时间戳' })
      return
    }
    // 10 位按秒、13 位按毫秒，其余按数值大小推断
    const num = Number(raw)
    const ms = raw.length >= 13 ? num : raw.length === 10 ? num * 1000 : (num < 1e12 ? num * 1000 : num)
    this.setData({ tsDate: fmtDateTime(new Date(ms)) })
  },

  onDateForTs(e) {
    this.setData({ dateForTs: e.detail.value }, () => this.calcDateToTs())
  },

  onTimeForTs(e) {
    this.setData({ timeForTs: e.detail.value }, () => this.calcDateToTs())
  },

  calcDateToTs() {
    const date = parseDate(this.data.dateForTs)
    if (!date) return
    const [h, m] = this.data.timeForTs.split(':').map(Number)
    date.setHours(h || 0, m || 0, 0, 0)
    this.setData({ dateTsResult: String(date.getTime()) })
  },

  copyTs() {
    const text = this.data.tsInput || this.data.nowTs
    this.copyText(text)
  },

  // ===== 倒计时 =====
  onTargetDate(e) {
    this.setData({ targetDate: e.detail.value })
  },

  onTargetTime(e) {
    this.setData({ targetTime: e.detail.value })
  },

  startCountdown() {
    this.stopCountdown()
    const date = parseDate(this.data.targetDate)
    if (!date) return wx.showToast({ title: '请选择目标日期', icon: 'none' })
    const [h, m] = this.data.targetTime.split(':').map(Number)
    date.setHours(h || 0, m || 0, 0, 0)
    this._target = date.getTime()

    if (this._target <= Date.now()) {
      this.setData({ cdRunning: false })
      return wx.showToast({ title: '目标时间已过去', icon: 'none' })
    }

    this.setData({ cdRunning: true })
    this.tickCountdown()
    this._timer = setInterval(() => this.tickCountdown(), 1000)
  },

  tickCountdown() {
    const left = this._target - Date.now()
    if (left <= 0) {
      this.stopCountdown()
      this.setData({ cdDays: '0', cdHours: '00', cdMins: '00', cdSecs: '00' })
      wx.showToast({ title: '时间到', icon: 'none' })
      return
    }
    const sec = Math.floor(left / 1000)
    this.setData({
      cdDays: String(Math.floor(sec / 86400)),
      cdHours: pad(Math.floor(sec % 86400 / 3600)),
      cdMins: pad(Math.floor(sec % 3600 / 60)),
      cdSecs: pad(sec % 60)
    })
  },

  stopCountdown() {
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
      this.setData({ cdRunning: false })
    }
  },

  /** 从 dataset 取文本复制（WXML 绑定用） */
  onCopyTap(e) {
    this.copyText(e.currentTarget.dataset.text)
  },

  copyText(text) {
    if (!text) return
    wx.setClipboardData({
      data: String(text),
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    })
  }
})
