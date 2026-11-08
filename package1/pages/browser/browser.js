Page({
  data: {
    url: '',
    displayUrl: '',
    title: '',
    paragraphs: [],
    images: [],
    items: [],
    isSearch: false,
    searchKeyword: '',
    loading: false,
    error: false,
    errorMsg: ''
  },

  onLoad(options) {
    if (options.url) {
      const url = decodeURIComponent(options.url)
      const type = options.type || 'page'
      const isSearch = type === 'search'
      let searchKeyword = ''
      if (isSearch) {
        const wdMatch = url.match(/[?&](?:wd|q|query|word)=([^&]+)/i)
        if (wdMatch) searchKeyword = decodeURIComponent(wdMatch[1])
      }
      this.setData({
        url,
        displayUrl: this.shortenUrl(url),
        isSearch,
        searchKeyword
      })
      this.loadPage(url, type)
    }
  },

  shortenUrl(url) {
    try {
      const u = url.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
      return u.length > 35 ? u.substring(0, 35) + '...' : u
    } catch (e) {
      return url
    }
  },

  loadPage(url, type) {
    this.setData({ loading: true, error: false, paragraphs: [], images: [], items: [], title: '' })

    // 超时保护：15秒内无响应则提示
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      this.setData({
        loading: false,
        error: true,
        errorMsg: '请求超时，请检查网络或稍后重试'
      })
    }, 15000)

    wx.cloud.callFunction({
      name: 'fetchWeb',
      data: { url, type: type || 'page' },
      success: (res) => {
        if (timedOut) return
        clearTimeout(timer)
        const result = res.result
        if (result.code === 0) {
          const paragraphs = result.paragraphs || []
          const title = result.title || ''
          const images = result.images || []
          const items = result.items || []

          // 检测内容是否为空/极少（JS 渲染页面）
          const totalTextLen = paragraphs.reduce((sum, p) => sum + ((p.text || '').length), 0)
          const isEmptyContent = !title && totalTextLen < 30 && images.length === 0 && items.length === 0

          if (isEmptyContent) {
            this.setData({
              loading: false,
              error: true,
              errorMsg: '该页面使用 JavaScript 动态渲染，无法在小程序内提取内容'
            })
          } else {
            this.setData({
              title,
              paragraphs,
              images,
              items,
              loading: false
            })
          }
        } else {
          this.setData({
            loading: false,
            error: true,
            errorMsg: result.msg || '加载失败'
          })
        }
      },
      fail: (err) => {
        if (timedOut) return
        clearTimeout(timer)
        this.setData({
          loading: false,
          error: true,
          errorMsg: '网络请求失败，请检查云函数是否已部署'
        })
        console.error('云函数调用失败', err)
      }
    })
  },

  retry() {
    if (this.data.url) {
      const type = this.data.isSearch ? 'search' : 'page'
      this.loadPage(this.data.url, type)
    }
  },

  refreshPage() {
    this.retry()
  },

  goBack() {
    wx.navigateBack({ delta: 1 })
  },

  copyUrl() {
    wx.setClipboardData({
      data: this.data.url,
      success: () => { wx.showToast({ title: '链接已复制', icon: 'success' }) },
      fail: () => { wx.showToast({ title: '复制失败', icon: 'none' }) }
    })
  },

  showActions() {
    wx.showActionSheet({
      itemList: ['复制链接', '在浏览器中打开', '刷新页面'],
      success: (res) => {
        switch (res.tapIndex) {
          case 0: this.copyUrl(); break
          case 1:
            wx.setClipboardData({
              data: this.data.url,
              success: () => { wx.showToast({ title: '链接已复制，请在浏览器中打开', icon: 'none', duration: 2000 }) }
            })
            break
          case 2: this.refreshPage(); break
        }
      }
    })
  },

  openLink(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    // 跳转到新页面加载链接
    wx.navigateTo({
      url: `/package1/pages/browser/browser?url=${encodeURIComponent(url)}`
    })
  },

  previewImage(e) {
    const src = e.currentTarget.dataset.src
    const images = this.data.images.map(img => img.src)
    wx.previewImage({ current: src, urls: images })
  }
})
