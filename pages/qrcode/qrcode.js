Page({
  data: {
    currentTab: 0,
    tabs: [
      { name: '文本', placeholder: '输入任意文本内容', maxLength: 500 },
      { name: '网址', placeholder: 'https://example.com', maxLength: 500 },
      { name: '电话', placeholder: '输入手机号或座机号', maxLength: 20 },
      { name: 'WiFi', placeholder: 'SSID;Password', maxLength: 100 }
    ],
    inputText: '',
    qrcodePath: '',
    canGenerate: false,
    showResult: false,
    resultAnimating: false,
    generating: false,
    _inputTimer: null
  },

  onShow() {
    const tab = this.data.tabs[this.data.currentTab]
    this.setData({
      placeholderText: tab.placeholder,
      maxLength: tab.maxLength
    })
  },

  switchTab(e) {
    const index = e.currentTarget.dataset.index
    const tab = this.data.tabs[index]
    this.setData({
      currentTab: index,
      inputText: '',
      placeholderText: tab.placeholder,
      maxLength: tab.maxLength,
      canGenerate: false
    })
  },

  onInput(e) {
    const val = e.detail.value
    this.setData({ inputText: val })
    if (this.data._inputTimer) clearTimeout(this.data._inputTimer)
    this.data._inputTimer = setTimeout(() => {
      this.setData({ canGenerate: !!val.trim() })
    }, 150)
  },

  onInputBlur() {
    if (this.data._inputTimer) clearTimeout(this.data._inputTimer)
    this.setData({ canGenerate: !!this.data.inputText.trim() })
  },

  async pasteFromClipboard() {
    try {
      const res = await wx.getClipboardData()
      if (res.data) {
        this.setData({ inputText: res.data, canGenerate: true })
        wx.showToast({ title: '已粘贴', icon: 'success', duration: 1200 })
      } else {
        wx.showToast({ title: '剪贴板为空', icon: 'none' })
      }
    } catch (_) {
      wx.showToast({ title: '读取失败，请手动输入', icon: 'none' })
    }
  },

  async generateQR() {
    const text = this.data.inputText.trim()
    if (!text) {
      wx.showToast({ title: '请输入内容', icon: 'none' })
      return
    }
    this.setData({ generating: true })
    wx.showLoading({ title: '生成中...', mask: true })

    try {
      const res = await wx.cloud.callFunction({
        name: 'qrcodeGen',
        data: { text }
      })
      if (res.result && res.result.success && res.result.dataUrl) {
        this.handleResult(res.result.dataUrl)
      } else {
        await this.generateViaAPI(text)
      }
    } catch (_) {
      await this.generateViaAPI(text)
    }
  },

  async generateViaAPI(text) {
    const url = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(text)}`
    try {
      const res = await new Promise((resolve, reject) => {
        wx.downloadFile({ url, success: resolve, fail: reject })
      })
      this.handleResult(res.tempFilePath)
    } catch (e) {
      wx.hideLoading()
      this.setData({ generating: false })
      wx.showToast({ title: '网络异常，请检查网络', icon: 'none' })
      console.error('API生成失败:', e)
    }
  },

  handleResult(path) {
    wx.hideLoading()
    this.setData({
      qrcodePath: path,
      showResult: true,
      resultAnimating: true,
      generating: false
    })
    setTimeout(() => this.setData({ resultAnimating: false }), 400)
  },

  closeResult() {
    this.setData({ showResult: false })
    setTimeout(() => this.setData({ qrcodePath: '' }), 350)
  },

  saveQR() {
    if (!this.data.qrcodePath) return
    wx.showLoading({ title: '保存中...', mask: true })
    const fp = this.data.qrcodePath

    if (fp.indexOf('http') !== 0 && fp.indexOf('data:') !== 0) {
      this.saveToAlbum(fp)
      return
    }

    const fs = wx.getFileSystemManager()
    const b64 = fp.replace(/^data:image\/\w+;base64,/, '')
    const local = `${wx.env.USER_DATA_PATH}/qrcode_${Date.now()}.png`
    try {
      fs.writeFileSync(local, b64, 'base64')
      this.saveToAlbum(local)
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '写入失败', icon: 'none' })
    }
  },

  saveToAlbum(filePath) {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: () => {
        wx.hideLoading()
        wx.showToast({ title: '已保存到相册', icon: 'success' })
      },
      fail: (err) => {
        wx.hideLoading()
        if (err.errMsg.includes('auth deny') || err.errMsg.includes('auth denied')) {
          wx.showModal({
            title: '相册授权',
            content: '需要相册权限才能保存二维码',
            confirmText: '去设置',
            success: (r) => { if (r.confirm) wx.openSetting() }
          })
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' })
        }
      }
    })
  },

  clearQR() {
    this.setData({
      showResult: false,
      qrcodePath: '',
      inputText: '',
      canGenerate: false
    })
  },

  noop() {}
})
