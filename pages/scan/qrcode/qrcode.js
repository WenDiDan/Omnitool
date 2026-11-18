const qrLocal = require('../../../utils/qr-local.js')

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
    generating: false
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
    if (this._inputTimer) clearTimeout(this._inputTimer)
    this._inputTimer = setTimeout(() => {
      this.setData({ canGenerate: !!val.trim() })
    }, 150)
  },

  onInputBlur() {
    if (this._inputTimer) clearTimeout(this._inputTimer)
    this.setData({ canGenerate: !!this.data.inputText.trim() })
  },

  onUnload() {
    if (this._inputTimer) {
      clearTimeout(this._inputTimer)
      this._inputTimer = null
    }
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

  /**
   * 本地生成二维码：Canvas 2D 绘制后导出临时图片
   * 不调用云函数、外部接口或在线图片服务，离线可用
   */
  async generateQR() {
    const text = this.data.inputText.trim()
    if (!text) {
      wx.showToast({ title: '请输入内容', icon: 'none' })
      return
    }
    if (this.data.generating) return

    this.setData({ generating: true })
    wx.showLoading({ title: '生成中...', mask: true })

    try {
      const info = await this.getQrCanvas()
      if (!info || !info.node) throw new Error('canvas not ready')

      const canvas = info.node
      const size = Math.min(info.width || 300, info.height || 300) || 300
      const dpr = (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2

      canvas.width = size * dpr
      canvas.height = size * dpr
      const ctx = canvas.getContext('2d')
      ctx.scale(dpr, dpr)

      qrLocal.draw(ctx, text, size)
      const path = await qrLocal.exportTempFilePath(canvas)
      this.handleResult(path)
    } catch (e) {
      wx.hideLoading()
      this.setData({ generating: false })
      wx.showToast({ title: '生成失败，请重试', icon: 'none' })
      console.error('[qrcode] 本地生成失败', e)
    }
  },

  /** 获取离屏 Canvas 节点与尺寸 */
  getQrCanvas() {
    return new Promise((resolve) => {
      wx.createSelectorQuery()
        .select('#qrCanvas')
        .fields({ node: true, size: true })
        .exec((res) => resolve(res && res[0]))
    })
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
      // 先校验本地文件可用，坏文件给出明确提示而不是存进相册
      wx.getImageInfo({
        src: fp,
        success: () => this.saveToAlbum(fp),
        fail: () => {
          wx.hideLoading()
          wx.showToast({ title: '图片文件无效，请重新生成', icon: 'none', duration: 2000 })
        }
      })
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
    const doSave = () => {
      wx.saveImageToPhotosAlbum({
        filePath,
        success: () => {
          wx.hideLoading()
          wx.showToast({ title: '已保存到相册', icon: 'success' })
        },
        fail: (err) => {
          wx.hideLoading()
          const msg = (err && err.errMsg) || ''
          console.error('[qrcode] 保存失败', msg)
          if (msg.indexOf('cancel') !== -1) {
            // 用户主动取消，不打扰
            return
          }
          // 授权被拒的 errMsg 各版本不一：auth deny / auth denied / authorize no response 等
          if (msg.indexOf('auth') !== -1 || msg.indexOf('permission') !== -1) {
            wx.showModal({
              title: '相册授权',
              content: '需要相册权限才能保存二维码，请在设置中开启',
              confirmText: '去设置',
              success: (r) => { if (r.confirm) wx.openSetting() }
            })
          } else {
            wx.showToast({ title: '保存失败：' + msg.replace(/^saveImageToPhotosAlbum:fail:?/, ''), icon: 'none' })
          }
        }
      })
    }

    // 预检查相册权限：从未请求过则先 authorize，被拒过则引导去设置
    wx.getSetting({
      success: (s) => {
        const scope = s.authSetting['scope.writePhotosAlbum']
        if (scope === false) {
          wx.hideLoading()
          wx.showModal({
            title: '相册授权',
            content: '需要相册权限才能保存二维码，请在设置中开启',
            confirmText: '去设置',
            success: (r) => { if (r.confirm) wx.openSetting() }
          })
        } else if (scope === true) {
          doSave()
        } else {
          wx.authorize({ scope: 'scope.writePhotosAlbum', success: doSave, fail: () => {
            wx.hideLoading()
            wx.showToast({ title: '未获得相册权限', icon: 'none' })
          } })
        }
      },
      fail: doSave
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
