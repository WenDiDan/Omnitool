/**
 * 编码转换工具模块
 * 提供 Base64 / URL / Unicode / HTML 实体等多种编码互转
 */

const encodeTools = {

  // ===== Base64 =====

  base64Encode(str) {
    try {
      return Buffer.from(str, 'utf-8').toString('base64');
    } catch (e) {
      // 小程序环境 fallback
      return btoa(unescape(encodeURIComponent(str)));
    }
  },

  base64Decode(str) {
    try {
      return Buffer.from(str, 'base64').toString('utf-8');
    } catch (e) {
      try {
        return decodeURIComponent(escape(atob(str)));
      } catch (e2) {
        return '无效的Base64';
      }
    }
  },

  isBase64(str) {
    return /^[A-Za-z0-9+/]+=*$/.test(str) && str.length > 0 && str.length % 4 === 0;
  },

  // ===== URL =====

  urlEncode(str) {
    return encodeURIComponent(str);
  },

  urlDecode(str) {
    try {
      return decodeURIComponent(str);
    } catch (e) {
      return '无效的URL编码';
    }
  },

  hasUrlEncode(str) {
    return /%[0-9a-fA-F]{2}/.test(str);
  },

  // ===== Unicode =====

  unicodeEncode(str) {
    return str.replace(/[\u4e00-\u9fa5]/g, ch =>
      '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0')
    );
  },

  unicodeDecode(str) {
    try {
      return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, code) =>
        String.fromCharCode(parseInt(code, 16))
      );
    } catch (e) {
      return '无效的Unicode编码';
    }
  },

  hasUnicode(str) {
    return /\\u[0-9a-fA-F]{4}/.test(str);
  },

  // ===== HTML 实体 =====

  htmlEncode(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  htmlDecode(str) {
    const entities = {
      '&amp;': '&', '&lt;': '<', '&gt;': '>',
      '&quot;': '"', '&#39;': "'", '&nbsp;': ' '
    };
    return str.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, m => entities[m] || m);
  },

  hasHtmlEntity(str) {
    return /&(?:amp|lt|gt|quot|#39|nbsp);/.test(str);
  }
};

/**
 * 对一个字符串执行所有编码转换计算，返回结果对象
 * @param {string} code - 待转换的字符串
 * @returns {Object} 各类编码/解码结果
 */
function computeAllEncodeResults(code) {
  const t = encodeTools;
  const results = {};

  // Base64
  try {
    results.base64Encode = t.base64Encode(code);
    if (t.isBase64(code)) {
      results.base64Decode = t.base64Decode(code);
    }
  } catch (e) {}

  // URL
  results.urlEncode = t.urlEncode(code);
  if (t.hasUrlEncode(code)) {
    results.urlDecode = t.urlDecode(code);
  }

  // Unicode
  results.unicodeEncode = t.unicodeEncode(code);
  if (t.hasUnicode(code)) {
    results.unicodeDecode = t.unicodeDecode(code);
  }

  // HTML
  results.htmlEncode = t.htmlEncode(code);
  if (t.hasHtmlEntity(code)) {
    results.htmlDecode = t.htmlDecode(code);
  }

  return results;
}

/**
 * 将编码结果转为列表格式（供 wxml wx:for 渲染）
 * @param {Object} results - computeAllEncodeResults 返回的结果
 * @returns {Array<{key:string, label:string, value:string}>}
 */
function encodeResultsToList(results) {
  const list = [
    { key: 'base64Encode',  label: 'Base64 编码',   value: results.base64Encode },
    { key: 'base64Decode',  label: 'Base64 解码',   value: results.base64Decode },
    { key: 'urlEncode',     label: 'URL 编码',      value: results.urlEncode },
    { key: 'urlDecode',     label: 'URL 解码',      value: results.urlDecode },
    { key: 'unicodeEncode', label: 'Unicode 编码',  value: results.unicodeEncode },
    { key: 'unicodeDecode', label: 'Unicode 解码',  value: results.unicodeDecode },
    { key: 'htmlEncode',    label: 'HTML 实体编码', value: results.htmlEncode },
    { key: 'htmlDecode',    label: 'HTML 实体解码', value: results.htmlDecode },
  ];
  return list.filter(item => item.value);
}

module.exports = {
  encodeTools,
  computeAllEncodeResults,
  encodeResultsToList
};
