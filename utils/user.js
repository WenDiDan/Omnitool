// 防抖函数
const debounce = (func, wait) => {
  let timeout
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout)
      func(...args)
    }
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
  }
}

// 格式化文件大小
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 KB'
  const k = 1024
  const sizes = ['KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// 安全验证
const validateNickname = (nickname) => {
  if (!nickname || nickname.trim().length === 0) {
    return '昵称不能为空'
  }
  if (nickname.length > 20) {
    return '昵称不能超过20个字符'
  }
  return null
}

module.exports = {
  debounce,
  formatFileSize,
  validateNickname
}