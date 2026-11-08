const cloud = require('wx-server-sdk')
const QRCode = require('qrcode')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event) => {
  const { text, errorLevel } = event
  
  if (!text || !text.trim()) {
    return { success: false, error: '请输入内容' }
  }

  const level = ['L', 'M', 'Q', 'H'].includes(errorLevel) ? errorLevel : 'M'

  try {
    const dataUrl = await QRCode.toDataURL(text.trim(), {
      width: 400,
      margin: 2,
      errorCorrectionLevel: level,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    })
    
    return { success: true, dataUrl }
  } catch (err) {
    console.error('二维码生成失败:', err)
    return { success: false, error: err.message || '生成失败' }
  }
}
