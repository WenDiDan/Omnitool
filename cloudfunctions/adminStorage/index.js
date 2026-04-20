const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// 云存储操作
exports.main = async (event, context) => {
  const { action, cloudPath } = event

  try {
    // 获取当前环境的腾讯云cos上下文
    const cloudPathWithoutEnv = cloudPath.replace(/cloud:\/\/[^/]+\//, '')
    
    switch (action) {
      case 'getTempUrl':
        // 获取临时访问链接
        try {
          const result = await cloud.getTempFileURL({
            fileList: [cloudPath]
          })
          if (result.fileList && result.fileList[0]) {
            const fileInfo = result.fileList[0]
            if (fileInfo.status === 0 && fileInfo.tempFileURL) {
              return {
                success: true,
                url: fileInfo.tempFileURL
              }
            } else {
              return {
                success: false,
                error: fileInfo.errMsg || '获取链接失败'
              }
            }
          }
        } catch (e) {
          return {
            success: false,
            error: e.message || '获取链接失败'
          }
        }
        break
      
      case 'upload':
        // 上传文件
        const uploadResult = await cloud.uploadFile({
          cloudPath: cloudPath,
          fileContent: Buffer.from(event.fileContent, 'base64')
        })
        return {
          success: true,
          fileID: uploadResult.fileID
        }
      
      case 'delete':
        // 删除文件
        await cloud.deleteFile({
          fileList: [cloudPath]
        })
        return { success: true }
      
      default:
        return {
          success: false,
          error: '未知操作'
        }
    }
  } catch (e) {
    return {
      success: false,
      error: e.message || '操作失败'
    }
  }
}
