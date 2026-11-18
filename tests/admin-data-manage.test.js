/**
 * 管理后台用户页：分页 / 加载更多 / 服务端搜索 / 返回值判空回归
 */

let pageDef

global.Page = (def) => { pageDef = def }
global.getApp = () => ({ globalData: { userInfo: { openid: 'admin' } } })

function makeWx(callFunction) {
  return {
    cloud: { callFunction },
    showLoading: jest.fn(),
    hideLoading: jest.fn(),
    showToast: jest.fn(),
    setClipboardData: jest.fn(),
    showActionSheet: jest.fn(),
    showModal: jest.fn()
  }
}

require('../pages/admin/data-manage.js')

const USERS = [
  { openid: 'a', nickName: 'A', role: 'user', retentionDays: 3 },
  { openid: 'b', nickName: 'B', role: 'vip', retentionDays: 10 },
  { openid: 'c', nickName: 'C', role: 'admin', retentionDays: 365 }
]

function makeCtx(overrides = {}) {
  const ctx = {
    data: {
      users: [],
      searchKey: '',
      page: 1,
      pageSize: 50,
      total: 0,
      hasMore: false,
      loading: false,
      loadingMore: false,
      showEditModal: false,
      editUser: null,
      editDays: 3,
      editVipRemainDays: 0,
      myOpenid: 'a',
      stats: { admin: 0, vip: 0, user: 0, blocked: 0 },
      ...overrides
    },
    setData: jest.fn(function (patch) { Object.assign(ctx.data, patch) })
  }
  ctx.mergeUsers = pageDef.mergeUsers
  ctx.decorateUsers = pageDef.decorateUsers
  ctx.applyRole = pageDef.applyRole
  ctx.showEdit = pageDef.showEdit
  ctx.showRoleEdit = pageDef.showRoleEdit
  ctx.confirmRole = pageDef.confirmRole
  return ctx
}

beforeEach(() => {
  global.wx = makeWx(jest.fn())
})

afterEach(() => {
  delete global.wx
})

describe('loadUsers 分页', () => {
  test('首次加载请求第 1 页并计算 hasMore', async () => {
    global.wx = makeWx(jest.fn(async () => ({
      result: { success: true, total: 120, page: 1, pageSize: 50, users: USERS }
    })))
    const ctx = makeCtx()

    await pageDef.loadUsers.call(ctx, true)

    expect(global.wx.cloud.callFunction).toHaveBeenCalledWith({
      name: 'userManage',
      data: { action: 'listUsers', page: 1, pageSize: 50, keyword: '', role: '' }
    })
    expect(ctx.data.users).toHaveLength(3)
    expect(ctx.data.total).toBe(120)
    expect(ctx.data.hasMore).toBe(true)
    expect(ctx.data.loading).toBe(false)
  })

  test('加载更多追加下一页并按 openid 去重', async () => {
    global.wx = makeWx(jest.fn(async () => ({
      result: {
        success: true,
        total: 4,
        users: [USERS[1], USERS[2], { openid: 'd', nickName: 'D', role: 'user' }]
      }
    })))
    const ctx = makeCtx({ users: [USERS[0], USERS[1]], page: 1, total: 4, hasMore: true })

    await pageDef.loadUsers.call(ctx, false)

    expect(global.wx.cloud.callFunction.mock.calls[0][0].data.page).toBe(2)
    expect(ctx.data.users.map(u => u.openid)).toEqual(['a', 'b', 'c', 'd'])
    expect(ctx.data.hasMore).toBe(false)
  })

  test('没有更多时不再发请求', async () => {
    const ctx = makeCtx({ users: USERS, page: 1, total: 3, hasMore: false })
    await pageDef.loadUsers.call(ctx, false)
    expect(global.wx.cloud.callFunction).not.toHaveBeenCalled()
  })

  test('返回值缺失时提示加载失败且不抛错', async () => {
    global.wx = makeWx(jest.fn(async () => undefined))
    const ctx = makeCtx()

    await expect(pageDef.loadUsers.call(ctx, true)).resolves.toBeUndefined()
    expect(global.wx.showToast).toHaveBeenCalledWith({ title: '加载失败', icon: 'none' })
  })
})

describe('服务端搜索', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('输入 300ms 后携带关键词重新加载第一页', () => {
    const ctx = makeCtx()
    ctx.loadUsers = jest.fn()

    pageDef.onSearchInput.call(ctx, { detail: { value: '小明' } })
    expect(ctx.data.searchKey).toBe('小明')
    expect(ctx.loadUsers).not.toHaveBeenCalled()

    jest.advanceTimersByTime(300)
    expect(ctx.loadUsers).toHaveBeenCalledWith(true, '小明')
  })

  test('连续输入只触发最后一次搜索', () => {
    const ctx = makeCtx()
    ctx.loadUsers = jest.fn()

    pageDef.onSearchInput.call(ctx, { detail: { value: 'a' } })
    pageDef.onSearchInput.call(ctx, { detail: { value: 'ab' } })
    jest.advanceTimersByTime(300)

    expect(ctx.loadUsers).toHaveBeenCalledTimes(1)
    expect(ctx.loadUsers).toHaveBeenCalledWith(true, 'ab')
  })

  test('onUnload 清理未执行的搜索定时器', () => {
    const ctx = makeCtx()
    ctx.loadUsers = jest.fn()

    pageDef.onSearchInput.call(ctx, { detail: { value: 'a' } })
    pageDef.onUnload.call(ctx)
    jest.advanceTimersByTime(300)

    expect(ctx.loadUsers).not.toHaveBeenCalled()
  })
})

describe('checkAdmin', () => {
  test('按管理员等级校验（requiredLevel=3）后再加载列表', async () => {
    global.wx = makeWx(jest.fn(async () => ({
      result: { success: true, hasPermission: true, role: 'admin', level: 3 }
    })))
    const ctx = { data: {} }
    ctx.loadUsers = jest.fn()

    await pageDef.checkAdmin.call(ctx)

    const payload = global.wx.cloud.callFunction.mock.calls[0][0].data
    expect(payload).toMatchObject({ action: 'checkPermission', requiredLevel: 3 })
    expect(payload.targetOpenid).toBeUndefined()
    expect(ctx.loadUsers).toHaveBeenCalledTimes(1)
  })
})

describe('用户管理合并：统计 / 角色 / 删除', () => {
  test('loadUsers 接收角色统计并补充展示字段', async () => {
    global.wx = makeWx(jest.fn(async () => ({
      result: {
        success: true,
        total: 2,
        stats: { admin: 1, vip: 1, user: 0, blocked: 0 },
        users: [
          { openid: 'a', role: 'vip', roleLabel: 'VIP用户', vipExpiresAt: '2026-12-01T00:00:00.000Z', createdAt: '2026-11-05T10:00:00.000Z' },
          { openid: 'b', role: 'user', roleLabel: '普通用户' }
        ]
      }
    })))
    const ctx = makeCtx()

    await pageDef.loadUsers.call(ctx, true)

    expect(ctx.data.stats).toEqual({ admin: 1, vip: 1, user: 0, blocked: 0 })
    const u = ctx.data.users[0]
    expect(u.joinedText).toBe('2026-11-05')
    expect(u.vipText).toContain('VIP')
    expect(ctx.data.users[1].vipText).toBe('')
  })

  test('不能修改自己的角色', () => {
    const ctx = makeCtx({ users: USERS })
    pageDef.showRoleEdit.call(ctx, { currentTarget: { dataset: { openid: 'a' } } })
    expect(global.wx.showActionSheet).not.toHaveBeenCalled()
    expect(global.wx.showToast).toHaveBeenCalled()
  })

  test('VIP 指定天数：30 天 → 带 vipExpiresAt 提交并刷新列表', () => {
    // 页面走 success 回调，mock 需同步触发
    const cf = jest.fn((opts) => {
      const data = { result: { success: true } }
      if (opts && opts.success) opts.success(data)
      return Promise.resolve(data)
    })
    global.wx = makeWx(cf)
    global.wx.showModal = jest.fn(({ success }) => success({ confirm: true, content: '30' }))
    const ctx = makeCtx({ users: USERS })
    ctx.loadUsers = jest.fn()

    pageDef.promptVipDays.call(ctx, 'b')

    const payload = cf.mock.calls[0][0].data
    expect(payload).toMatchObject({ action: 'setRole', targetOpenid: 'b', role: 'vip' })
    expect(payload.vipExpiresAt).toBeTruthy()
    expect(ctx.loadUsers).toHaveBeenCalledWith(true)
  })

  test('VIP 天数 0 → 永久（vipExpiresAt 为空）', () => {
    global.wx = makeWx(jest.fn((opts) => {
      const data = { result: { success: true } }
      if (opts && opts.success) opts.success(data)
      return Promise.resolve(data)
    }))
    global.wx.showModal = jest.fn(({ success }) => success({ confirm: true, content: '0' }))
    const ctx = makeCtx({ users: USERS })
    ctx.loadUsers = jest.fn()

    pageDef.promptVipDays.call(ctx, 'b')

    const payload = global.wx.cloud.callFunction.mock.calls[0][0].data
    expect(payload.role).toBe('vip')
    expect(payload.vipExpiresAt).toBe('')
  })

  test('确认删除后调用 deleteUser 并刷新', () => {
    global.wx = makeWx(jest.fn((opts) => {
      const data = { result: { success: true } }
      if (opts && opts.success) opts.success(data)
      return Promise.resolve(data)
    }))
    global.wx.showModal = jest.fn(({ success }) => success({ confirm: true }))
    const ctx = makeCtx({ users: USERS })
    ctx.loadUsers = jest.fn()

    pageDef.confirmDelete.call(ctx, { currentTarget: { dataset: { openid: 'b' } } })

    const payload = global.wx.cloud.callFunction.mock.calls[0][0].data
    expect(payload).toEqual({ action: 'deleteUser', targetOpenid: 'b' })
    expect(ctx.loadUsers).toHaveBeenCalledWith(true)
  })

  test('不能删除自己', () => {
    const ctx = makeCtx({ users: USERS })
    pageDef.confirmDelete.call(ctx, { currentTarget: { dataset: { openid: 'a' } } })
    expect(global.wx.showModal).not.toHaveBeenCalled()
    expect(global.wx.showToast).toHaveBeenCalled()
  })

  test('点击 ID 复制', () => {
    const ctx = makeCtx()
    pageDef.copyOpenid.call(ctx, { currentTarget: { dataset: { openid: 'oX' } } })
    expect(global.wx.setClipboardData).toHaveBeenCalledWith(expect.objectContaining({ data: 'oX' }))
  })
})

describe('统计卡角色筛选', () => {
  test('点击统计卡按角色筛选并刷新，重复点击不刷新', () => {
    const ctx = makeCtx()
    ctx.loadUsers = jest.fn()

    pageDef.tapStat.call(ctx, { currentTarget: { dataset: { role: 'vip' } } })
    expect(ctx.data.activeRole).toBe('vip')
    expect(ctx.data.activeRoleLabel).toBe('VIP')
    expect(ctx.loadUsers).toHaveBeenCalledWith(true)

    // 同一卡片再点不重复加载
    ctx.loadUsers.mockClear()
    pageDef.tapStat.call(ctx, { currentTarget: { dataset: { role: 'vip' } } })
    expect(ctx.loadUsers).not.toHaveBeenCalled()
  })

  test('清除筛选后请求恢复全量', () => {
    const cf = jest.fn(async () => ({
      result: { success: true, total: 1, stats: { admin: 1, vip: 0, user: 0, blocked: 0 }, users: [USERS[0]] }
    }))
    global.wx = makeWx(cf)
    const ctx = makeCtx({ activeRole: 'vip', activeRoleLabel: 'VIP' })
    ctx.loadUsers = jest.fn()

    pageDef.clearRoleFilter.call(ctx)
    expect(ctx.data.activeRole).toBe('')
    expect(ctx.loadUsers).toHaveBeenCalledWith(true)
  })
})

describe('saveRetention', () => {
  test('保存成功后同时更新 retentionDays 与 historyRetentionDays', async () => {
    global.wx = makeWx(jest.fn(async () => ({ result: { success: true } })))
    const ctx = makeCtx({ editUser: USERS[0], editDays: 15, users: [...USERS] })

    await pageDef.saveRetention.call(ctx)

    const patch = ctx.setData.mock.calls[0][0]
    expect(patch).toMatchObject({
      'users[0].retentionDays': 15,
      'users[0].historyRetentionDays': 15,
      showEditModal: false
    })
  })
})
