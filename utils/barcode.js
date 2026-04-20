/**
 * 条码识别与解码工具模块（增强版）
 */

// 扩展国家/地区前缀映射
const COUNTRY_MAP = {
  '690': '中国', '691': '中国', '692': '中国', '693': '中国',
  '694': '中国', '695': '中国', '696': '中国', '697': '中国',
  '00': '美国', '01': '美国', '02': '美国', '03': '美国', '04': '美国',
  '30': '法国', '31': '法国', '32': '法国', '33': '法国', '34': '法国',
  '40': '德国', '41': '德国', '42': '德国', '43': '德国',
  '45': '日本', '46': '日本', '47': '日本', '48': '日本', '49': '日本',
  '50': '英国', '51': '英国',
  '54': '比利时', '55': '比利时',
  '56': '葡萄牙', '57': '丹麦',
  '70': '挪威', '71': '挪威',
  '73': '瑞典', '74': '瑞典',
  '76': '瑞士', '77': '瑞士',
  '80': '意大利', '81': '意大利', '82': '意大利', '83': '意大利',
  '84': '西班牙', '85': '西班牙',
  '87': '荷兰',
  '88': '韩国', '89': '韩国',
  '90': '奥地利', '91': '奥地利',
  '93': '澳大利亚',
  '94': '新西兰',
  '880': '韩国', '890': '印度',
  '460': '俄罗斯', '469': '俄罗斯',
  '471': '中国台湾', '474': '爱沙尼亚',
  '475': '拉脱维亚', '476': '阿塞拜疆',
  '477': '立陶宛', '478': '乌兹别克斯坦',
  '480': '菲律宾', '481': '白俄罗斯',
  '482': '乌克兰', '484': '摩尔多瓦',
  '485': '亚美尼亚', '486': '格鲁吉亚',
  '487': '哈萨克斯坦', '489': '中国香港',
  '520': '希腊', '528': '黎巴嫩',
  '529': '塞浦路斯', '531': '马其顿',
  '535': '马耳他', '539': '爱尔兰',
  '560': '葡萄牙', '569': '冰岛',
  '590': '波兰', '594': '罗马尼亚',
  '599': '匈牙利', '600': '南非', '601': '南非',
  '611': '摩洛哥', '613': '阿尔及利亚',
  '616': '肯尼亚', '618': '科特迪瓦',
  '619': '突尼斯', '621': '叙利亚',
  '622': '埃及', '625': '约旦',
  '626': '伊朗', '627': '科威特',
  '628': '沙特阿拉伯', '629': '阿联酋',
  '775': '秘鲁', '777': '玻利维亚',
  '778': '阿根廷', '779': '阿根廷',
  '780': '智利', '784': '巴拉圭',
  '786': '厄瓜多尔', '789': '巴西',
  '850': '古巴', '858': '斯洛伐克',
  '859': '捷克', '860': '塞尔维亚',
  '865': '蒙古', '867': '朝鲜',
  '868': '土耳其', '869': '土耳其',
  '955': '马来西亚', '958': '中国澳门'
};

// 微信 scanType 到友好名称的映射
const SCANTYPE_MAP = {
  'QR_CODE': '二维码',
  'AZTEC': 'Aztec码',
  'CODABAR': 'Codabar码',
  'CODE_39': 'Code 39',
  'CODE_93': 'Code 93',
  'CODE_128': 'Code 128',
  'DATA_MATRIX': 'Data Matrix',
  'EAN_8': 'EAN-8',
  'EAN_13': 'EAN-13',
  'ITF': 'ITF',
  'MAXI_CODE': 'MaxiCode',
  'PDF_417': 'PDF417',
  'RSS_14': 'RSS 14',
  'RSS_EXPANDED': 'RSS Expanded',
  'UPC_A': 'UPC-A',
  'UPC_E': 'UPC-E',
  'UPC_EAN_EXTENSION': 'UPC/EAN扩展'
};

/**
 * 识别条码类型（增强版，优先使用微信scanType）
 */
function identifyBarcodeType(code, wxScanType) {
  // 优先使用微信API返回的scanType
  if (wxScanType && SCANTYPE_MAP[wxScanType]) {
    // 对于ISBN，EAN-13带978/979前缀时特殊标记
    if (wxScanType === 'EAN_13' && /^(978|979)/.test(code)) return 'ISBN';
    return SCANTYPE_MAP[wxScanType];
  }
  // 兜底：正则识别
  if (/^WIFI:/i.test(code)) return 'WiFi二维码';
  if (/^BEGIN:VCARD/i.test(code)) return 'vCard名片';
  if (/^mailto:/i.test(code)) return '邮箱';
  if (/^tel:/i.test(code)) return '电话';
  if (/^smsto:/i.test(code)) return '短信';
  if (/^\d{13}$/.test(code)) {
    if (/^(978|979)/.test(code)) return 'ISBN';
    return 'EAN-13';
  }
  if (/^\d{12}$/.test(code)) return 'UPC-A';
  if (/^\d{8}$/.test(code)) return 'EAN-8';
  if (/^https?:\/\//i.test(code)) return 'URL';
  if (/^\d+$/.test(code)) return '数字条码';
  return '文本';
}

/**
 * 解码条码（增强版，支持更多格式）
 */
function decodeBarcode(code, wxScanType) {
  const result = {
    type: identifyBarcodeType(code, wxScanType),
    data: code,
    valid: true
  };

  // ISBN
  if (/^\d{13}$/.test(code) && /^(978|979)/.test(code)) {
    result.type = 'ISBN';
    result.isbn = code;
    result.country = getCountry(code.substring(0, 3));
    result.valid = validateEAN13(code);
  }
  // EAN-13（非ISBN）
  else if (/^\d{13}$/.test(code)) {
    result.type = 'EAN-13';
    result.countryCode = code.substring(0, 3);
    result.manufacturerCode = code.substring(3, 7);
    result.productCode = code.substring(7, 12);
    result.checkDigit = code.substring(12);
    result.country = getCountry(code.substring(0, 3));
    result.valid = validateEAN13(code);
  }
  // EAN-8
  else if (/^\d{8}$/.test(code)) {
    result.type = 'EAN-8';
    result.countryCode = code.substring(0, 2);
    result.productCode = code.substring(2, 7);
    result.checkDigit = code.substring(7);
    result.valid = validateEAN8(code);
  }
  // UPC-A
  else if (/^\d{12}$/.test(code)) {
    result.type = 'UPC-A';
    result.manufacturerCode = code.substring(0, 5);
    result.productCode = code.substring(5, 11);
    result.checkDigit = code.substring(11);
    result.valid = validateUPC(code);
  }
  // URL
  else if (/^https?:\/\//i.test(code)) {
    result.type = 'URL';
    result.url = code;
    try {
      const urlObj = /^https?:\/\//i.test(code) ? code : 'http://' + code;
      const match = urlObj.match(/^https?:\/\/([^\/\?]+)/i);
      result.domain = match ? match[1] : '';
    } catch (e) {
      result.domain = '';
    }
  }
  // WiFi
  else if (/^WIFI:/i.test(code)) {
    result.type = 'WiFi二维码';
    const wifi = parseWifi(code);
    result.ssid = wifi.ssid;
    result.encryption = wifi.encryption;
    result.password = wifi.password;
    result.hidden = wifi.hidden;
  }
  // vCard
  else if (/^BEGIN:VCARD/i.test(code)) {
    result.type = 'vCard名片';
    const vcard = parseVCard(code);
    result.vcardName = vcard.name;
    result.vcardPhone = vcard.phone;
    result.vcardEmail = vcard.email;
    result.vcardOrg = vcard.org;
  }
  // 邮箱
  else if (/^mailto:/i.test(code)) {
    result.type = '邮箱';
    result.email = code.replace(/^mailto:/i, '');
  }
  // 电话
  else if (/^tel:/i.test(code)) {
    result.type = '电话';
    result.phone = code.replace(/^tel:/i, '');
  }
  // 短信
  else if (/^smsto:/i.test(code)) {
    result.type = '短信';
    const parts = code.replace(/^smsto:/i, '').split(':');
    result.smsPhone = parts[0] || '';
    result.smsBody = parts[1] || '';
  }
  // 纯数字
  else if (/^\d+$/.test(code)) {
    result.type = '数字条码';
  }

  return result;
}

/**
 * 解析WiFi二维码内容
 * 格式: WIFI:T:WPA;S:MyNetwork;P:MyPassword;H:true;;
 */
function parseWifi(code) {
  const result = { ssid: '', encryption: '', password: '', hidden: false };
  const tMatch = code.match(/T:([^;]*)/i);
  const sMatch = code.match(/S:([^;]*)/i);
  const pMatch = code.match(/P:([^;]*)/i);
  const hMatch = code.match(/H:([^;]*)/i);
  if (tMatch) result.encryption = tMatch[1] || '无';
  if (sMatch) result.ssid = sMatch[1];
  if (pMatch) result.password = pMatch[1];
  if (hMatch) result.hidden = hMatch[1].toLowerCase() === 'true';
  return result;
}

/**
 * 解析vCard内容
 */
function parseVCard(code) {
  const result = { name: '', phone: '', email: '', org: '' };
  const fnMatch = code.match(/^FN:(.+)$/mi);
  const telMatch = code.match(/^TEL[^:]*:(.+)$/mi);
  const emailMatch = code.match(/^EMAIL[^:]*:(.+)$/mi);
  const orgMatch = code.match(/^ORG:(.+)$/mi);
  if (fnMatch) result.name = fnMatch[1].trim();
  if (telMatch) result.phone = telMatch[1].trim();
  if (emailMatch) result.email = emailMatch[1].trim();
  if (orgMatch) result.org = orgMatch[1].trim();
  return result;
}

/**
 * 判断条码内容是否可直接操作（URL/WiFi/电话/邮箱等）
 */
function isActionable(code) {
  if (/^https?:\/\//i.test(code)) return 'url';
  if (/^WIFI:/i.test(code)) return 'wifi';
  if (/^tel:/i.test(code)) return 'phone';
  if (/^mailto:/i.test(code)) return 'email';
  return null;
}

function validateEAN13(code) {
  const digits = code.split('').map(Number);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += digits[i] * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10 === digits[12];
}

function validateEAN8(code) {
  const digits = code.split('').map(Number);
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    sum += digits[i] * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === digits[7];
}

function validateUPC(code) {
  const digits = code.split('').map(Number);
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    sum += digits[i] * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === digits[11];
}

function getCountry(code) {
  for (const [prefix, country] of Object.entries(COUNTRY_MAP)) {
    if (code.startsWith(prefix)) return country;
  }
  return '未知';
}

// 编码转换工具
const encodeTools = {
  // Base64 编码
  base64Encode(str) {
    try {
      return Buffer.from(str, 'utf-8').toString('base64')
    } catch (e) {
      // 小程序环境 fallback
      return btoa(unescape(encodeURIComponent(str)))
    }
  },
  // Base64 解码
  base64Decode(str) {
    try {
      return Buffer.from(str, 'base64').toString('utf-8')
    } catch (e) {
      try { return decodeURIComponent(escape(atob(str))) } catch (e2) { return '无效的Base64' }
    }
  },
  // URL 编码
  urlEncode(str) {
    return encodeURIComponent(str)
  },
  // URL 解码
  urlDecode(str) {
    try { return decodeURIComponent(str) } catch (e) { return '无效的URL编码' }
  },
  // Unicode 转中文 (\uXXXX → 中文)
  unicodeDecode(str) {
    try {
      return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    } catch (e) { return '无效的Unicode编码' }
  },
  // 中文转 Unicode
  unicodeEncode(str) {
    return str.replace(/[\u4e00-\u9fa5]/g, ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'))
  },
  // HTML 实体解码
  htmlDecode(str) {
    const entities = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' }
    return str.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, m => entities[m] || m)
  },
  // HTML 实体编码
  htmlEncode(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  },
  // 判断是否可能是 Base64
  isBase64(str) {
    return /^[A-Za-z0-9+/]+=*$/.test(str) && str.length % 4 === 0
  },
  // 判断是否包含 Unicode 转义
  hasUnicode(str) {
    return /\\u[0-9a-fA-F]{4}/.test(str)
  },
  // 判断是否包含 URL 编码
  hasUrlEncode(str) {
    return /%[0-9a-fA-F]{2}/.test(str)
  },
  // 判断是否包含 HTML 实体
  hasHtmlEntity(str) {
    return /&(amp|lt|gt|quot|#39|nbsp);/.test(str)
  }
}

module.exports = {
  identifyBarcodeType,
  decodeBarcode,
  isActionable,
  parseWifi,
  parseVCard,
  validateEAN13,
  validateEAN8,
  validateUPC,
  getCountry,
  encodeTools
};
