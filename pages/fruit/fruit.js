/**
 * 多多水果互助 · 口令互换广场
 *
 * 模式：邀请码互换广场（无任务流转、无凭证）
 * - 一码一人：拼多多组队码被一位果友使用后即失效
 * - 「领取」= 复制邀请码 + 原子抢占唯一名额，领取后从广场下线
 * - 「智能直达」= 一键领取最新可用邀请码（服务端抢占，失败自动换下一条）
 * - 发布者可在「我的记录」重置（放回广场）或下架后重新发布
 * - 云函数：fruitApi（publish / mine / list / help / auto / used / reset / remove）
 */
const FN_NAME = 'fruitApi'
const MAX_CONTENT_LEN = 200

/**
 * 从粘贴的分享文案中提取 8-9 位数字邀请码（拼多多生鲜券组队码格式）
 * 按连续数字段匹配，恰好 8-9 位才有效：11 位手机号、更长的订单号不会被误提取
 */
function extractInviteCode(text) {
  const re = /\d+/g
  let m
  while ((m = re.exec(String(text || ''))) !== null) {
    if (m[0].length >= 8 && m[0].length <= 9) return m[0]
  }
  return ''
}

/** 广场展示打码：隐藏中间 3 位，如 903417268 → 903***268 */
function maskMiddle(code) {
  const s = String(code || '')
  if (s.length <= 4) return s
  const hide = 3
  const start = Math.floor((s.length - hide) / 2)
  return s.slice(0, start) + '*'.repeat(hide) + s.slice(start + hide)
}

/** 短时间展示：当天 HH:MM，跨天 MM-DD HH:MM */
function fmtShortTime(iso) {
  if (!iso) return ''
  const d = new Date(String(iso).replace(' ', 'T'))
  if (isNaN(d.getTime())) return iso
  const now = new Date()
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  if (sameDay) return hm
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hm}`
}

/** 相对时间展示：刚刚 / N 分钟前 / N 小时前 / 昨天 / MM-DD */
function fmtRelative(iso) {
  if (!iso) return ''
  const d = new Date(String(iso).replace(' ', 'T'))
  if (isNaN(d.getTime())) return iso
  const diff = Date.now() - d.getTime()
  if (diff < 60 * 1000) return '刚刚'
  if (diff < 3600 * 1000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 24 * 3600 * 1000) return `${Math.floor(diff / 3600000)} 小时前`
  if (diff < 48 * 3600 * 1000) return '昨天'
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${m}-${day}`
}

function callFn(action, data) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: FN_NAME,
      data: Object.assign({ action }, data || {}),
      success: (res) => {
        const result = res && res.result
        if (result && result.success) resolve(result.data)
        else reject(new Error((result && result.error) || '请求失败'))
      },
      fail: (err) => reject(new Error((err && err.errMsg) || '网络异常'))
    })
  })
}

Page({
  data: {
    input: '',
    // 诚信互助承诺（发布前必须勾选）；勾选状态本地缓存，下次进入自动回显
    agreed: wx.getStorageSync('fruitAgreed') === true,
    mines: [],            // 我发布的口令（可多条）
    items: [],            // 广场列表
    total: 0,             // 可用邀请码总数
    offset: 0,
    hasMore: false,
    loading: true,
    loadingMore: false,
    publishing: false,
    autoLoading: false,
    showTips: false,
    showRecords: false,   // 我的记录弹窗
    tab: 'mine',          // 我的记录标签：mine 我发布的 / used 我使用的
    used: [],             // 我使用的记录
    usedLoaded: false,
    usedLoading: false,
    maxLen: MAX_CONTENT_LEN
  },

  toggleTips() {
    this.setData({ showTips: !this.data.showTips })
  },

  toggleAgree() {
    const agreed = !this.data.agreed
    this.setData({ agreed })
    try { wx.setStorageSync('fruitAgreed', agreed) } catch (e) { /* 忽略缓存写入异常 */ }
  },

  onLoad() {
    this.refreshAll()
  },

  onPullDownRefresh() {
    this.refreshAll().finally(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore) this.loadMore()
  },

  onShareAppMessage() {
    return { title: '多多水果互助 · 果园口令互换广场', path: '/pages/home/home' }
  },

  refreshAll() {
    this.setData({ loading: true, offset: 0, hasMore: false })
    return Promise.all([this.refreshMine(), this.loadList(0), this.loadUsed()])
      .catch(e => wx.showToast({ title: e.message, icon: 'none' }))
      .finally(() => this.setData({ loading: false }))
  },

  refreshMine() {
    return callFn('mine').then(data => {
      const mines = ((data && data.items) || []).map(it =>
        Object.assign({}, it, { timeText: fmtShortTime(it.updated_at) })
      )
      this.setData({ mines })
    })
  },

  loadList(offset) {
    return callFn('list', { offset }).then(data => {
      const items = (data.items || []).map(it => Object.assign({}, it, {
        timeText: fmtRelative(it.updated_at),
        // 广场展示打码：隐藏中间 3 位，领取并复制后才能看到完整口令
        masked: maskMiddle(it.content)
      }))
      if (offset === 0) {
        this.setData({ items, offset: items.length, hasMore: data.hasMore, total: data.total || 0 })
      } else {
        this.setData({ items: this.data.items.concat(items), offset: this.data.items.length, hasMore: data.hasMore })
      }
    })
  },

  loadMore() {
    this.setData({ loadingMore: true })
    this.loadList(this.data.offset)
      .catch(e => wx.showToast({ title: e.message, icon: 'none' }))
      .finally(() => this.setData({ loadingMore: false }))
  },

  openRecords() {
    this.setData({ showRecords: true })
    if (this.data.tab === 'used' && !this.data.usedLoaded) this.loadUsed()
  },

  closeRecords() {
    this.setData({ showRecords: false })
  },

  /** 阻止弹窗内容点击穿透到遮罩 */
  noop() {},

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (tab === this.data.tab) return
    this.setData({ tab })
    if (tab === 'used' && !this.data.usedLoaded) this.loadUsed()
  },

  loadUsed() {
    this.setData({ usedLoading: true })
    return callFn('used')
      .then(data => {
        const used = (data.items || []).map(it => Object.assign({}, it, { timeText: fmtRelative(it.created_at) }))
        this.setData({ used, usedLoaded: true })
      })
      .catch(e => wx.showToast({ title: e.message, icon: 'none' }))
      .finally(() => this.setData({ usedLoading: false }))
  },

  // ===== 发布 =====
  onInput(e) {
    this.setData({ input: e.detail.value })
  },

  /** 相册识别：选一张分享海报截图，压缩后上传并 OCR 提取邀请码 */
  scanAlbum() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album'],
      success: (res) => {
        const f = res.tempFiles && res.tempFiles[0]
        if (!f || !f.tempFilePath) return
        this.uploadAndOcr(f.tempFilePath, f.size)
      }
    })
  },

  /** OCR 提交前压缩：chooseMedia 已默认压缩，超大图再压一轮，避免 OCR 报图片过大 */
  uploadAndOcr(filePath, size) {
    if (size && size > 2 * 1024 * 1024) {
      wx.compressImage({
        src: filePath,
        quality: 60,
        success: (r) => this.uploadAndOcr(r.tempFilePath, 0),
        fail: () => this.uploadAndOcr(filePath, 0)
      })
      return
    }
    wx.showLoading({ title: '识别中…', mask: true })
    wx.cloud.uploadFile({
      cloudPath: `fruit-ocr/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`,
      filePath,
      success: (up) => {
        callFn('ocr', { fileID: up.fileID })
          .then((data) => {
            if (!data || !data.code) {
              wx.showToast({ title: '未识别到 8-9 位邀请码，可手动填写', icon: 'none' })
              return
            }
            this.setData({ input: data.code })
            wx.showToast({ title: '识别成功', icon: 'success' })
          })
          .catch(e => wx.showToast({ title: e.message, icon: 'none' }))
      },
      fail: () => wx.showToast({ title: '图片上传失败', icon: 'none' }),
      complete: () => wx.hideLoading()
    })
  },

  publish() {
    if (!this.data.agreed) {
      return wx.showToast({ title: '请先勾选诚信互助承诺', icon: 'none' })
    }
    const raw = this.data.input.trim()
    if (!raw) return wx.showToast({ title: '请先粘贴邀请码', icon: 'none' })
    const code = extractInviteCode(raw)
    if (!code) {
      return wx.showToast({ title: '未识别到 8-9 位数字邀请码', icon: 'none' })
    }
    this.setData({ publishing: true })
    callFn('publish', { content: code })
      .then(() => {
        wx.showToast({ title: '已发布', icon: 'success' })
        this.setData({ input: '' })
        return Promise.all([this.refreshMine(), this.loadList(0)])
          .then(() => this.setData({ offset: this.data.items.length }))
      })
      .catch(e => wx.showToast({ title: e.message, icon: 'none' }))
      .finally(() => this.setData({ publishing: false }))
  },

  // ===== 智能直达：一键领取最新可用邀请码 =====
  onAuto() {
    if (this.data.autoLoading) return
    this.setData({ autoLoading: true })
    wx.showLoading({ title: '正在为你挑选', mask: true })
    callFn('auto')
      .then((data) => {
        wx.hideLoading()
        if (!data || !data.content) {
          wx.showToast({ title: '广场暂时没有可领取的邀请码', icon: 'none' })
          return
        }
        wx.setClipboardData({
          data: String(data.content),
          success: () => wx.showModal({
            title: '已复制邀请码',
            content: `邀请码 ${data.content} 已复制，打开拼多多 APP 搜索即可组队助力。`,
            showCancel: false,
            confirmText: '知道了',
            confirmColor: '#C0553D'
          })
        })
        this.setData({
          items: this.data.items.filter(it => it.id !== data.id),
          offset: Math.max(0, this.data.offset - 1),
          total: Math.max(0, (this.data.total || 1) - 1)
        })
        this.loadUsed()
      })
      .catch(e => {
        wx.hideLoading()
        wx.showToast({ title: e.message, icon: 'none' })
      })
      .finally(() => this.setData({ autoLoading: false }))
  },

  // ===== 我发布的口令（逐条操作） =====
  copyMine(e) {
    this.copyText(e.currentTarget.dataset.content)
  },

  resetMine(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.showModal({
      title: '重置邀请码',
      content: '若领取的果友没有完成组队，可重置名额，邀请码将重新回到广场。',
      confirmText: '重置',
      confirmColor: '#C0553D',
      success: (res) => {
        if (!res.confirm) return
        callFn('reset', { id })
          .then(() => {
            wx.showToast({ title: '已重新上架', icon: 'success' })
            return Promise.all([this.refreshMine(), this.loadList(0)])
              .then(() => this.setData({ offset: this.data.items.length }))
          })
          .catch(e => wx.showToast({ title: e.message, icon: 'none' }))
      }
    })
  },

  removeMine(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.showModal({
      title: '下架邀请码',
      content: '下架后其他人将看不到你的邀请码，可随时重新发布。',
      confirmText: '下架',
      confirmColor: '#C0553D',
      success: (res) => {
        if (!res.confirm) return
        callFn('remove', { id })
          .then(() => {
            wx.showToast({ title: '已下架', icon: 'success' })
            return Promise.all([this.refreshMine(), this.loadList(0)])
              .then(() => this.setData({ offset: this.data.items.length }))
          })
          .catch(e => wx.showToast({ title: e.message, icon: 'none' }))
      }
    })
  },

  // ===== 广场：领取邀请码（一码一人，抢占名额） =====
  onHelp(e) {
    const { id, content } = e.currentTarget.dataset
    if (!id || !content) return
    // 自己发布的口令不可自领（服务端同样拦截，这里只做即时提示）
    const target = this.data.items.find(it => it.id === id)
    if (target && target.is_mine) {
      return wx.showToast({ title: '不能领取自己发布的邀请码', icon: 'none' })
    }
    wx.showModal({
      title: '领取邀请码',
      content: '将复制邀请码并锁定这条组队名额（一码一人）。请尽快去拼多多 APP 搜索组队，领取后该邀请码会从广场下线。',
      confirmText: '领取',
      confirmColor: '#C0553D',
      success: (res) => {
        if (!res.confirm) return
        callFn('help', { id, content })
          .then((data) => {
            if (data && data.claimed) {
              wx.setClipboardData({
                data: String(content),
                success: () => wx.showToast({ title: '已复制，去拼多多APP搜索组队', icon: 'none', duration: 2500 })
              })
              const idx = this.data.items.findIndex(it => it.id === id)
              if (idx > -1) {
                this.setData({
                  items: this.data.items.filter(it => it.id !== id),
                  offset: Math.max(0, this.data.offset - 1),
                  total: Math.max(0, (this.data.total || 1) - 1)
                })
              }
              this.loadUsed()
            } else if (data && data.own) {
              wx.setClipboardData({
                data: String(content),
                success: () => wx.showToast({ title: data.message || '你已领取过这条邀请码', icon: 'none' })
              })
            }
          })
          .catch(e => wx.showToast({ title: e.message, icon: 'none' }))
      }
    })
  },

  copyUsed(e) {
    this.copyText(e.currentTarget.dataset.content)
  },

  copyText(text) {
    if (!text) return
    wx.setClipboardData({
      data: String(text),
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    })
  }
})
