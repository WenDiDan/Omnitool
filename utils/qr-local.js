/**
 * 本地二维码生成（无网络依赖）
 *
 * 编码：内置于 utils/vendor/qrcode-generator.js（MIT，qrcode-generator@2.0.4）
 * 绘制：调用方传入 Canvas 2D context，本模块只负责矩阵与像素绘制
 *
 * 说明：不调用任何云函数、外部接口或在线图片服务，离线可用。
 */

const qrcode = require('./vendor/qrcode-generator.js')

// 库默认按 ISO-8859-1 转字节，这里切换为 UTF-8，保证中文/emoji 可被扫码识别
qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8']

const DEFAULT_DARK = '#2B1D18'
const DEFAULT_LIGHT = '#FFFFFF'

/**
 * 生成二维码矩阵
 * @param {string} text
 * @param {string} [ecLevel='M'] L/M/Q/H
 * @returns {{ moduleCount: number, isDark: Function }}
 */
function createMatrix(text, ecLevel = 'M') {
  const content = String(text == null ? '' : text)
  if (!content) throw new Error('text is required')
  const qr = qrcode(0, ecLevel) // typeNumber 0 = 自动选择版本
  qr.addData(content, 'Byte')
  qr.make()
  return qr
}

/**
 * 把二维码绘制到 Canvas 2D context
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} size 绘制边长（CSS px）
 * @param {object} [options] { colorDark, colorLight, margin }
 * @returns {number} 实际模块数
 */
function draw(ctx, text, size, options = {}) {
  const { colorDark = DEFAULT_DARK, colorLight = DEFAULT_LIGHT, margin = 4 } = options
  const qr = createMatrix(text)
  const count = qr.getModuleCount()
  const total = count + margin * 2
  const cell = size / total

  ctx.fillStyle = colorLight
  ctx.fillRect(0, 0, size, size)

  ctx.fillStyle = colorDark
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!qr.isDark(row, col)) continue
      const x = Math.floor((col + margin) * cell)
      const y = Math.floor((row + margin) * cell)
      const w = Math.ceil(cell)
      ctx.fillRect(x, y, w, w)
    }
  }
  return count
}

/** 校验导出的临时文件有效（存在且非空） */
function validateFile(path) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().stat({
      path,
      success: (s) => {
        const len = s.size || (s.stats && s.stats.size) || 0
        // 小于 512 字节的 PNG 基本都是损坏/空白图
        if (len > 512) resolve(path)
        else reject(new Error('exported image invalid, size=' + len))
      },
      fail: reject
    })
  })
}

/** base64 dataURL → 用户目录临时文件（导出兜底） */
function dataUrlToTempFile(dataUrl) {
  const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
  const p = `${wx.env.USER_DATA_PATH}/qr_${Date.now()}.png`
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().writeFile({
      filePath: p,
      data: b64,
      encoding: 'base64',
      success: () => resolve(p),
      fail: reject
    })
  })
}

/**
 * Canvas 导出临时图片（Promise 包装，带文件校验与 toDataURL 兜底）
 * 说明：Canvas 2D 的 width/height 为物理像素，导出需按物理尺寸取整个画布，
 *       否则 DPR>1 时只能截取左上角一部分。
 * @param {object} canvasNode Canvas 2D 节点
 * @returns {Promise<string>} tempFilePath
 */
function exportTempFilePath(canvasNode) {
  const size = canvasNode.width
  return new Promise((resolve, reject) => {
    // 留足时间给 Canvas 完成绘制，避免部分机型导出空白/损坏图
    setTimeout(() => {
      wx.canvasToTempFilePath({
        canvas: canvasNode,
        x: 0,
        y: 0,
        width: size,
        height: size,
        destWidth: size,
        destHeight: size,
        fileType: 'png',
        success: (res) => {
          validateFile(res.tempFilePath).then(resolve).catch(reject)
        },
        fail: (err) => {
          // 兜底：canvasToTempFilePath 失败时尝试 toDataURL 导出
          try {
            const dataUrl = canvasNode.toDataURL('image/png')
            dataUrlToTempFile(dataUrl)
              .then(validateFile)
              .then(resolve)
              .catch(() => reject(err))
          } catch (_) {
            reject(err)
          }
        }
      })
    }, 120)
  })
}

module.exports = {
  createMatrix,
  draw,
  exportTempFilePath
}
