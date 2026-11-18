const app = getApp()

const FN_NAME = 'toolsManage'
const REQUIRED_LEVEL = 3

Page({
  data: {
    tools: [],
    loading: true,
    saving: false,
    showModal: false,
    editing: null,
    navOptions: [
      { value: 'navigateTo', label: 'navigateTo（普通页面）' },
      { value: 'switchTab', label: 'switchTab（tab 页）' },
      { value: 'reLaunch', label: 'reLaunch（重载跳转）' },
      { value: 'tool', label: 'tool（页面内导航）' }
    ],
    navIndex: 0
  },

  onLoad() {
    this.checkAdmin()
  },

  onPullDownRefresh() {
    this.loadTools(() => wx.stopPullDownRefresh())
  },

  /** 管理入口：服务端按调用者身份校验等级，前端这层只做友好提示 */
  async checkAdmin() {
    const userInfo = app.globalData.userInfo
    if (!userInfo || !userInfo.openid) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1000)
      return
    }
    try {
      const res = await wx.cloud.callFunction({
        name: 'userManage',
        data: { action: 'checkPermission', requiredLevel: REQUIRED_LEVEL }
      })
      const result = res && res.result
      if (result && result.hasPermission) {
        this.loadTools()
      } else {
        wx.showToast({ title: '无管理权限', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 1200)
      }
    } catch (e) {
      wx.showToast({ title: '权限校验失败', icon: 'none' })
    }
  },

  callFn(data) {
    return new Promise((resolve, reject) => {
      wx.cloud.callFunction({
        name: FN_NAME,
        data,
        success: (res) => {
          const result = res && res.result
          if (result && result.success) resolve(result)
          else reject(new Error((result && (result.message || result.error)) || '请求失败'))
        },
        fail: (err) => reject(new Error((err && err.errMsg) || '网络异常'))
      })
    })
  },

  loadTools(done) {
    this.setData({ loading: true })
    this.callFn({ action: 'adminList' })
      .then((data) => this.setData({ tools: data.tools || [] }))
      .catch(e => wx.showToast({ title: e.message, icon: 'none' }))
      .finally(() => {
        this.setData({ loading: false })
        if (typeof done === 'function') done()
      })
  },

  /** 列表内快捷上下线 */
  onToggleStatus(e) {
    const { key, status } = e.currentTarget.dataset
    const next = status === 'online' ? 'offline' : 'online'
    this.callFn({ action: 'adminSave', tool_key: key, status: next })
      .then(() => {
        const tools = this.data.tools.map(t => (t.tool_key === key ? { ...t, status: next } : t))
        this.setData({ tools })
        wx.showToast({ title: next === 'online' ? '已上线' : '已下线', icon: 'none' })
      })
      .catch(err => {
        wx.showToast({ title: err.message, icon: 'none' })
        this.loadTools()
      })
  },

  openEdit(e) {
    const key = e.currentTarget.dataset.key
    const tool = this.data.tools.find(t => t.tool_key === key)
    if (!tool) return
    const navIndex = Math.max(0, this.data.navOptions.findIndex(o => o.value === tool.navType))
    this.setData({ editing: { ...tool }, navIndex, showModal: true })
  },

  closeModal() {
    if (this.data.saving) return
    this.setData({ showModal: false })
  },

  stopTap() {},

  onFieldInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`editing.${field}`]: e.detail.value })
  },

  onNavChange(e) {
    const navIndex = Number(e.detail.value)
    this.setData({ navIndex, 'editing.navType': this.data.navOptions[navIndex].value })
  },

  onToggleFeatured(e) {
    this.setData({ 'editing.featured': e.detail.value })
  },

  async save() {
    const editing = this.data.editing
    if (!editing || this.data.saving) return
    if (!String(editing.name || '').trim()) {
      return wx.showToast({ title: '名称不能为空', icon: 'none' })
    }

    // 排序值 = 目标位置：变化时不直写（避免重复序号），保存成功后单独走全表重排 1..n
    const current = this.data.tools.find(t => t.tool_key === editing.tool_key)
    const origSort = current ? (Number(current.sort) || 0) : 0
    const newSort = Number(editing.sort) || 0
    const sortChanged = newSort !== origSort

    this.setData({ saving: true })
    try {
      await this.callFn({
        action: 'adminSave',
        tool_key: editing.tool_key,
        name: editing.name,
        app_name: editing.app_name,
        desc: editing.desc,
        category: editing.category,
        tag: editing.tag,
        badge: editing.badge,
        badgeColor: editing.badgeColor,
        url: editing.url,
        navType: editing.navType,
        featured: !!editing.featured,
        sort: sortChanged ? undefined : newSort,
        status: editing.status
      })

      if (sortChanged) {
        const list = this.data.tools
          .filter(t => t.tool_key !== editing.tool_key)
          .map(t => ({ tool_key: t.tool_key }))
        const idx = Math.max(0, Math.min(list.length, newSort - 1))
        list.splice(idx, 0, { tool_key: editing.tool_key })
        await this.callFn({
          action: 'adminReorder',
          items: list.map((t, i) => ({ tool_key: t.tool_key, sort: i + 1 }))
        })
      }

      this.setData({ showModal: false })
      wx.showToast({ title: '已保存', icon: 'success' })
      // 清掉首页工具清单缓存与版本号，让改动尽快生效
      try { wx.removeStorageSync('toolsCache') } catch (e) { /* 忽略 */ }
      try { wx.removeStorageSync('toolsVersionCache') } catch (e) { /* 忽略 */ }
      this.loadTools()
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  }
})
