const barcode = require('../../utils/barcode.js')
const qrcode = require('../../utils/qrcode.js')

Page({
  data: {
    inputCode: '',
    decodedResult: null,
    detectType: '',
    showEncodeTools: false,
    encodeResults: {},
    qrImagePath: '',
    showQrCode: false
  },

  onLoad(options) {
    if (options.code) {
      this.setData({ inputCode: decodeURIComponent(options.code) })
      this.decode()
    }
  },

  onInput(e) {
    const inputCode = e.detail.value
    const detectType = inputCode.trim() ? barcode.identifyBarcodeType(inputCode.trim()) : ''
    this.setData({ inputCode, decodedResult: null, detectType, encodeResults: {}, showEncodeTools: false })
  },

  // 粘贴
  pasteFromClipboard() {
    wx.getClipboardData({
      success: (res) => {
        if (res.data) {
          this.setData({ inputCode: res.data })
          this.decode()
        }
      }
    })
  },

  // 清空
  clearInput() {
    this.setData({ inputCode: '', decodedResult: null, detectType: '', encodeResults: {}, showEncodeTools: false, qrImagePath: '' })
  },

  // 解码
  decode() {
    const code = this.data.inputCode.trim()
    if (!code) {
      wx.showToast({ title: '请输入内容', icon: 'none' })
      return
    }

    const result = barcode.decodeBarcode(code)
    const detectType = barcode.identifyBarcodeType(code)

    // 自动计算编码转换
    const encodeResults = this.computeEncodeResults(code)

    // 计算是否有详情
    const r = result
    const hasDetails = !!(r.country || r.isbn || r.manufacturerCode || r.productCode || r.checkDigit || r.domain || r.ssid || r.vcardName || r.email || r.phone || r.smsPhone)

    // 编码列表（用于 wxml 循环）
    const encodeList = [
      { key: 'base64Encode', label: 'Base64 编码', value: encodeResults.base64Encode },
      { key: 'base64Decode', label: 'Base64 解码', value: encodeResults.base64Decode },
      { key: 'urlEncode', label: 'URL 编码', value: encodeResults.urlEncode },
      { key: 'urlDecode', label: 'URL 解码', value: encodeResults.urlDecode },
      { key: 'unicodeEncode', label: 'Unicode 编码', value: encodeResults.unicodeEncode },
      { key: 'unicodeDecode', label: 'Unicode 解码', value: encodeResults.unicodeDecode },
      { key: 'htmlEncode', label: 'HTML 实体编码', value: encodeResults.htmlEncode },
      { key: 'htmlDecode', label: 'HTML 实体解码', value: encodeResults.htmlDecode },
    ].filter(item => item.value)

    this.setData({
      decodedResult: result,
      detectType,
      encodeResults,
      encodeList,
      hasDetails,
      qrImagePath: ''
    })
  },

  // 计算编码转换结果
  computeEncodeResults(code) {
    const tools = barcode.encodeTools
    const results = {}

    // Base64
    try {
      results.base64Encode = tools.base64Encode(code)
      if (tools.isBase64(code)) {
        results.base64Decode = tools.base64Decode(code)
      }
    } catch (e) {}

    // URL
    results.urlEncode = tools.urlEncode(code)
    if (tools.hasUrlEncode(code)) {
      results.urlDecode = tools.urlDecode(code)
    }

    // Unicode
    results.unicodeEncode = tools.unicodeEncode(code)
    if (tools.hasUnicode(code)) {
      results.unicodeDecode = tools.unicodeDecode(code)
    }

    // HTML
    results.htmlEncode = tools.htmlEncode(code)
    if (tools.hasHtmlEntity(code)) {
      results.htmlDecode = tools.htmlDecode(code)
    }

    return results
  },

  // 切换编码工具展开
  toggleEncodeTools() {
    this.setData({ showEncodeTools: !this.data.showEncodeTools })
  },

  // 复制编码结果
  copyEncodeResult(e) {
    const key = e.currentTarget.dataset.key
    const value = this.data.encodeResults[key]
    if (value) {
      wx.setClipboardData({
        data: value,
        success: () => { wx.showToast({ title: '已复制', icon: 'success' }) }
      })
    }
  },

  // ===== 快捷操作 =====

  openUrl() {
    const url = this.data.inputCode.trim()
    if (/^https?:\/\//i.test(url)) {
      wx.navigateTo({
        url: `/package1/pages/browser/browser?url=${encodeURIComponent(url)}`
      })
    }
  },

  copyWifiPassword() {
    const pwd = this.data.decodedResult.password
    if (pwd) {
      wx.setClipboardData({
        data: pwd,
        success: () => { wx.showToast({ title: '密码已复制', icon: 'success' }) }
      })
    }
  },

  callPhone() {
    const phone = this.data.decodedResult.phone || this.data.inputCode.replace(/^tel:/i, '')
    if (phone) {
      wx.makePhoneCall({ phoneNumber: phone })
    }
  },

  copyEmail() {
    const email = this.data.decodedResult.email || this.data.inputCode.replace(/^mailto:/i, '')
    if (email) {
      wx.setClipboardData({
        data: email,
        success: () => { wx.showToast({ title: '邮箱已复制', icon: 'success' }) }
      })
    }
  },

  saveContact() {
    const r = this.data.decodedResult
    if (!r || !r.vcardName) return
    wx.addPhoneContact({
      firstName: r.vcardName,
      mobilePhoneNumber: r.vcardPhone || '',
      email: r.vcardEmail || '',
      organization: r.vcardOrg || '',
      fail: () => {}
    })
  },

  copyResult() {
    wx.setClipboardData({
      data: this.data.inputCode.trim(),
      success: () => { wx.showToast({ title: '已复制', icon: 'success' }) }
    })
  },

  searchResult() {
    const code = this.data.inputCode.trim()
    wx.navigateTo({
      url: `/package1/pages/browser/browser?url=${encodeURIComponent('https://www.baidu.com/s?wd=' + code)}&type=search`
    })
  },

  // ===== 生成二维码 =====

  generateQrCode() {
    const code = this.data.inputCode.trim()
    if (!code) return

    wx.showLoading({ title: '生成中...' })
    qrcode.makeQrCode({
      text: code,
      width: 200,
      canvasId: 'qrCanvas',
      ctx: this,
      colorDark: '#0D1B2A',
      colorLight: '#FFFFFF',
      callback: (res) => {
        wx.hideLoading()
        if (res.tempFilePath) {
          this.setData({ qrImagePath: res.tempFilePath, showQrCode: true })
        } else {
          wx.showToast({ title: '生成失败', icon: 'none' })
        }
      }
    })
  },

  saveQrCode() {
    if (!this.data.qrImagePath) return
    wx.saveImageToPhotosAlbum({
      filePath: this.data.qrImagePath,
      success: () => { wx.showToast({ title: '已保存到相册', icon: 'success' }) },
      fail: (err) => {
        if (err.errMsg.indexOf('auth deny') !== -1) {
          wx.showModal({
            title: '提示',
            content: '需要授权保存图片到相册',
            confirmText: '去设置',
            success: (res) => { if (res.confirm) wx.openSetting() }
          })
        }
      }
    })
  },

  closeQrCode() {
    this.setData({ showQrCode: false })
  },

  goRegCode() {
    wx.navigateTo({ url: '/package1/pages/regcode/regcode' })
  }
})
