/**
 * 图片解码模块
 * 封装从相册选择图片 → 条码/二维码识别的完整流程
 * 优先使用 Canvas 前端解码（无原生UI弹出），失败回退 wx.scanCode
 */

const canvasDecoder = require('./canvas-decoder.js');

/**
 * 从相册选择图片并解码条码/二维码
 * @param {Object} options
 * @param {Function} options.onStart - 开始识别回调
 * @param {Function} options.onSuccess - 成功回调 (result, scanType)
 * @param {Function} options.onFail - 失败回调 (errMsg)
 * @param {string} [options.mediaType='image'] - 媒体类型
 */
function decodeFromAlbum(options = {}) {
  const {
    onStart,
    onSuccess,
    onFail,
    mediaType = 'image'
  } = options;

  wx.chooseMedia({
    count: 1,
    mediaType: [mediaType],
    sourceType: ['album'],
    success: (res) => {
      const tempFilePath = res.tempFiles[0].tempFilePath;
      onStart && onStart();

      // copyFile 到自有沙盒，确保文件完全可读
      const fs = wx.getFileSystemManager();
      const localPath = `${wx.env.USER_DATA_PATH}/album_${Date.now()}.jpg`;

      fs.copyFile({
        srcPath: tempFilePath,
        destPath: localPath,
        success: () => {
          // 优先使用 Canvas 前端解码，失败才回退 wx.scanCode
          canvasDecoder.decodeFromImage(localPath, { onSuccess, onFail });
        },
        fail: () => {
          // copyFile 失败，用原路径
          canvasDecoder.decodeFromImage(tempFilePath, { onSuccess, onFail });
        }
      });
    },
    fail: (err) => {
      // 用户取消不提示
      if (err.errMsg && err.errMsg.indexOf('cancel') === -1) {
        onFail && onFail('无法访问相册');
      }
    }
  });
}

/**
 * 对指定图片路径进行条码/二维码识别（原生方式，会弹出扫码界面）
 * @param {string} imagePath - 图片文件路径
 * @param {Function} onSuccess - 成功回调
 * @param {Function} onFail - 失败回调
 */
function scanImageFile(imagePath, onSuccess, onFail) {
  canvasDecoder.decodeFromImage(imagePath, { onSuccess, onFail });
}

/**
 * 压缩图片后解码（用于大图片优化）
 * @param {string} imagePath - 图片路径
 * @param {Object} options
 * @param {number} [options.maxSide=1280] - 最大边长
 * @param {Function} options.onSuccess - 成功回调
 * @param {Function} options.onFail - 失败回调
 */
function decodeWithCompress(imagePath, options = {}) {
  const { maxSide = 1280, onSuccess, onFail } = options;

  wx.compressImage({
    src: imagePath,
    quality: 80,
    compressedWidth: maxSide,
    success: (compressRes) => {
      scanImageFile(compressRes.tempFilePath, onSuccess, onFail);
    },
    fail: () => {
      // 压缩失败直接用原图
      scanImageFile(imagePath, onSuccess, onFail);
    }
  });
}

module.exports = {
  decodeFromAlbum,
  scanImageFile,
  decodeWithCompress
};
