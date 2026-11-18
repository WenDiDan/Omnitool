const app = getApp()

const PAGE_SIZE = 50
const SEARCH_DEBOUNCE = 300

// 角色操作项（与云函数 ROLES 对齐；VIP 支持永久或指定天数）
const ROLE_OPTIONS = [
  { role: 'admin', label: '设为管理员' },
  { role: 'vip', label: '设为 VIP 用户（永久）' },
  { role: 'vip', label: '设为 VIP 用户（指定天数）', askDays: true },
  { role: 'user', label: '设为普通用户' },
  { role: 'blocked', label: '设为封禁' }
]

Page({
  data: {
    users: [],          // 已加载的用户（分页累加）
    searchKey: '',
    myOpenid: '',
    activeRole: '',   // 统计卡点击后的角色筛选（'' = 全部）
    activeRoleLabel: '',
    stats: { admin: 0, vip: 0, user: 0, blocked: 0 },
    page: 1,
    pageSize: PAGE_SIZE,
    total: 0,
    hasMore: false,
    loading: false,
    loadingMore: false,
    showEditModal: false,
    editUser: null,
    editDays: 3,
    editVipRemainDays: 0
  },

  onLoad() {
    const userInfo = app.globalData.userInfo
    this.setData({ myOpenid: (userInfo && userInfo.openid) || '' })
    this.checkAdmin()
  },

  onUnload() {
    if (this._searchTimer) clearTimeout(this._searchTimer)
  },

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
        // 管理页要求管理员等级（admin=3）；云端按调用者身份校验，targetOpenid 无效
        data: { action: 'checkPermission', requiredLevel: 3 }
      })
      const result = res && res.result
      if (result && result.hasPermission) {
        this.loadUsers()
      } else {
        wx.showToast({ title: '无管理权限', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 1000)
      }
    } catch (e) {
      wx.showToast({ title: '权限校验失败', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1000)
    }
  },

  onRefresh() {
    this.loadUsers(true)
  },

  /**
   * 加载用户列表
   * @param {boolean} reset 是否重置到第一页（刷新/搜索）
   * @param {string} [keyword] 服务端搜索关键词，默认取当前输入
   */
  async loadUsers(reset = true, keyword) {
    if (!reset && (this.data.loading || this.data.loadingMore)) return
    if (!reset && !this.data.hasMore) return

    const page = reset ? 1 : this.data.page + 1
    const searchKey = keyword !== undefined ? keyword : this.data.searchKey
    // 请求序号：搜索场景下丢弃过期响应，避免旧结果覆盖新结果
    const seq = (this._loadSeq = (this._loadSeq || 0) + 1)

    if (reset) {
      this.setData({ loading: true })
      wx.showLoading({ title: '加载中...' })
    } else {
      this.setData({ loadingMore: true })
    }

    try {
      const res = await wx.cloud.callFunction({
        name: 'userManage',
        data: {
          action: 'listUsers',
          page,
          pageSize: this.data.pageSize,
          keyword: String(searchKey || '').trim(),
          role: this.data.activeRole || ''
        }
      })
      if (seq !== this._loadSeq) return

      const result = res && res.result
      if (!result || !result.success) {
        wx.showToast({ title: (result && result.error) || '加载失败', icon: 'none' })
        return
      }

      const list = this.decorateUsers(result.users || [])
      const users = reset ? list : this.mergeUsers(this.data.users, list)
      const total = typeof result.total === 'number' ? result.total : users.length

      this.setData({
        users,
        page,
        total,
        hasMore: users.length < total,
        stats: result.stats || this.data.stats
      })
    } catch (e) {
      if (seq === this._loadSeq) {
        wx.showToast({ title: '网络异常', icon: 'none' })
      }
    } finally {
      if (seq === this._loadSeq) {
        if (reset) wx.hideLoading()
        this.setData({ loading: false, loadingMore: false })
      }
    }
  },

  /** 按 openid 合并分页数据，避免重复渲染同一用户 */
  mergeUsers(oldList, newList) {
    const map = new Map()
    ;(oldList || []).forEach(u => { if (u && u.openid) map.set(u.openid, u) })
    ;(newList || []).forEach(u => { if (u && u.openid) map.set(u.openid, u) })
    return Array.from(map.values())
  },

  /** 搜索：300ms 防抖后走服务端检索（不再只过滤当前页） */
  onSearchInput(e) {
    const searchKey = e.detail.value
    this.setData({ searchKey })
    if (this._searchTimer) clearTimeout(this._searchTimer)
    this._searchTimer = setTimeout(() => {
      this.loadUsers(true, searchKey)
    }, SEARCH_DEBOUNCE)
  },

  /** scroll-view 触底加载下一页 */
  loadMore() {
    this.loadUsers(false)
  },

  /** 点击统计卡：按角色筛选列表（再次点击取消） */
  tapStat(e) {
    const role = e.currentTarget.dataset.role || ''
    if (role === this.data.activeRole) return
    const labels = { admin: '管理员', vip: 'VIP', user: '普通用户', blocked: '封禁' }
    this.setData({
      activeRole: role,
      activeRoleLabel: labels[role] || ''
    })
    this.loadUsers(true)
  },

  /** 清除角色筛选 */
  clearRoleFilter() {
    if (!this.data.activeRole) return
    this.setData({ activeRole: '', activeRoleLabel: '' })
    this.loadUsers(true)
  },

  /** 补充展示字段：加入时间、VIP 描述（保留原字段与顺序，供索引 patch 使用） */
  decorateUsers(list) {
    return (list || []).map(u => ({
      ...u,
      joinedText: String(u.createdAt || '').slice(0, 10),
      vipText: u.role === 'vip'
        ? (u.vipExpiresAt ? 'VIP至 ' + String(u.vipExpiresAt).slice(0, 10) : 'VIP 永久')
        : ''
    }))
  },

  /** 点击 ID 复制 */
  copyOpenid(e) {
    const openid = e.currentTarget.dataset.openid
    if (!openid) return
    wx.setClipboardData({
      data: openid,
      success: () => wx.showToast({ title: 'ID 已复制', icon: 'none' })
    })
  },

  /** 角色 / VIP 设置：ActionSheet 选择后确认；VIP 可选永久或指定天数 */
  showRoleEdit(e) {
    const openid = e.currentTarget.dataset.openid
    if (!openid) return
    if (openid === this.data.myOpenid) {
      wx.showToast({ title: '不能修改自己的角色', icon: 'none' })
      return
    }
    const user = this.data.users.find(u => u.openid === openid)
    if (!user) return

    wx.showActionSheet({
      itemList: ROLE_OPTIONS.map(o => o.label),
      success: (res) => {
        const opt = ROLE_OPTIONS[res.tapIndex]
        if (!opt) return
        if (opt.askDays) {
          this.promptVipDays(openid)
        } else {
          this.confirmRole(openid, user, opt)
        }
      }
    })
  },

  /** VIP 天数输入（0 = 永久） */
  promptVipDays(openid) {
    wx.showModal({
      title: '设置 VIP 天数',
      editable: true,
      placeholderText: '输入天数，0 表示永久',
      success: (res) => {
        if (!res.confirm) return
        const days = parseInt(res.content, 10)
        if (isNaN(days) || days < 0) {
          wx.showToast({ title: '请输入非负整数天数', icon: 'none' })
          return
        }
        const vipExpiresAt = days > 0
          ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
          : ''
        this.applyRole(openid, 'vip', vipExpiresAt, days > 0 ? `VIP ${days} 天` : 'VIP 永久')
      }
    })
  },

  /** 二次确认后提交角色变更 */
  confirmRole(openid, user, opt) {
    wx.showModal({
      title: '确认操作',
      content: `将「${user.nickName || user.openid}」${opt.label.replace('设为', '设为')}？`,
      success: (res) => {
        if (res.confirm) this.applyRole(openid, opt.role, '', opt.label)
      }
    })
  },

  applyRole(openid, role, vipExpiresAt, label) {
    wx.showLoading({ title: '提交中...' })
    wx.cloud.callFunction({
      name: 'userManage',
      data: { action: 'setRole', targetOpenid: openid, role, vipExpiresAt },
      success: (res) => {
        wx.hideLoading()
        const result = res && res.result
        if (result && result.success) {
          wx.showToast({ title: `已${label}`, icon: 'none' })
          // 角色变化影响统计卡与保留天数，回到第一页重新加载
          this.loadUsers(true)
        } else {
          wx.showToast({ title: (result && result.error) || '操作失败', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '网络异常', icon: 'none' })
      }
    })
  },

  /** 删除用户（云端有最后一管理员与自我保护） */
  confirmDelete(e) {
    const openid = e.currentTarget.dataset.openid
    if (!openid) return
    if (openid === this.data.myOpenid) {
      wx.showToast({ title: '不能删除自己', icon: 'none' })
      return
    }
    const user = this.data.users.find(u => u.openid === openid)
    if (!user) return

    wx.showModal({
      title: '删除用户',
      content: `确定删除「${user.nickName || openid}」？该操作不可恢复。`,
      confirmColor: '#C0553D',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中...' })
        wx.cloud.callFunction({
          name: 'userManage',
          data: { action: 'deleteUser', targetOpenid: openid },
          success: (r) => {
            wx.hideLoading()
            const result = r && r.result
            if (result && result.success) {
              wx.showToast({ title: '已删除', icon: 'success' })
              this.loadUsers(true)
            } else {
              wx.showToast({ title: (result && result.error) || '删除失败', icon: 'none' })
            }
          },
          fail: () => {
            wx.hideLoading()
            wx.showToast({ title: '网络异常', icon: 'none' })
          }
        })
      }
    })
  },

  showEdit(e) {
    const openid = e.currentTarget.dataset.openid
    const user = this.data.users.find(u => u.openid === openid)
    if (!user) return

    // 计算 VIP 剩余天数（仅展示）
    let vipRemainDays = 0
    if (user.role === 'vip' && user.vipExpiresAt) {
      const expireDate = new Date(user.vipExpiresAt)
      const now = new Date()
      if (expireDate > now) {
        vipRemainDays = Math.ceil((expireDate - now) / (24 * 60 * 60 * 1000))
      }
    }

    this.setData({
      showEditModal: true,
      editUser: user,
      editDays: user.retentionDays || user.historyRetentionDays || 3,
      editVipRemainDays: vipRemainDays
    })
  },

  onEditDaysInput(e) {
    const days = parseInt(e.detail.value) || 1
    this.setData({ editDays: Math.min(days, 36500) })
  },

  async saveRetention() {
    const { editUser } = this.data
    if (!editUser) return
    wx.showLoading({ title: '保存中...' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'syncScanHistory',
        data: {
          action: 'setRetention',
          targetOpenid: editUser.openid,
          days: this.data.editDays
        }
      })
      wx.hideLoading()
      const result = res && res.result
      if (result && result.success) {
        const index = this.data.users.findIndex(u => u.openid === editUser.openid)
        if (index !== -1) {
          this.setData({
            [`users[${index}].retentionDays`]: this.data.editDays,
            [`users[${index}].historyRetentionDays`]: this.data.editDays,
            showEditModal: false,
            editUser: null
          })
        } else {
          this.setData({ showEditModal: false, editUser: null })
        }
        wx.showToast({ title: '保存成功', icon: 'success' })
      } else {
        wx.showToast({ title: (result && result.error) || '保存失败', icon: 'none' })
      }
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '网络异常', icon: 'none' })
    }
  },

  closeEditModal() {
    this.setData({ showEditModal: false, editUser: null })
  },

  formatDays(days) {
    if (days >= 36500) return '永久'
    return days + '天'
  },

  stopTap() {}
})
