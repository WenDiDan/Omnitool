/**
 * encode-utils.js 单元测试
 * 覆盖: encodeTools (base64/url/unicode/html 编解码),
 * computeAllEncodeResults, encodeResultsToList
 */

const { encodeTools, computeAllEncodeResults, encodeResultsToList } = require('../utils/encode-utils.js');

describe('encodeTools - Base64', () => {
  describe('base64Encode', () => {
    test('英文编码', () => {
      const r = encodeTools.base64Encode('Hello');
      expect(r).toBe('SGVsbG8=');
    });

    test('中文编码', () => {
      const r = encodeTools.base64Encode('你好');
      expect(r).toBe('5L2g5aW9');
    });

    test('空字符串编码', () => {
      expect(encodeTools.base64Encode('')).toBe('');
    });

    test('含特殊字符编码', () => {
      const r = encodeTools.base64Encode('a+b/c=d');
      expect(typeof r).toBe('string');
      expect(r.length).toBeGreaterThan(0);
    });
  });

  describe('base64Decode', () => {
    test('英文解码', () => {
      expect(encodeTools.base64Decode('SGVsbG8=')).toBe('Hello');
    });

    test('中文解码', () => {
      expect(encodeTools.base64Decode('5L2g5aW9')).toBe('你好');
    });

    test('无效 Base64 返回错误信息', () => {
      const r = encodeTools.base64Decode('!!!invalid!!!');
      expect(r).toBe('无效的Base64');
    });

    test('回环测试：编码后解码', () => {
      const original = 'Hello World 你好世界';
      const encoded = encodeTools.base64Encode(original);
      const decoded = encodeTools.base64Decode(encoded);
      expect(decoded).toBe(original);
    });

    test('URL 编码解码回环', () => {
      const original = 'https://www.test.com?q=测试';
      const encoded = encodeTools.base64Encode(original);
      const decoded = encodeTools.base64Decode(encoded);
      expect(decoded).toBe(original);
    });
  });

  describe('isBase64', () => {
    test('有效 Base64', () => {
      expect(encodeTools.isBase64('SGVsbG8=')).toBe(true);
    });

    test('长度非4倍数', () => {
      expect(encodeTools.isBase64('abc')).toBe(false);
    });

    test('含非法字符', () => {
      expect(encodeTools.isBase64('abc!def=')).toBe(false);
    });

    test('空字符串', () => {
      expect(encodeTools.isBase64('')).toBe(false);
    });

    test('只有等号', () => {
      // only '=' which doesn't pass length>0 && length%4===0 with = only?
      // '=' is not in [A-Za-z0-9+/], so regex fails
      expect(encodeTools.isBase64('=')).toBe(false);
    });

    test('无填充等号的有效 Base64', () => {
      expect(encodeTools.isBase64('aaaa')).toBe(true);
    });
  });
});

describe('encodeTools - URL', () => {
  describe('urlEncode', () => {
    test('中文编码', () => {
      const r = encodeTools.urlEncode('你好');
      expect(r).toBe('%E4%BD%A0%E5%A5%BD');
    });

    test('空格编码', () => {
      expect(encodeTools.urlEncode('a b')).toBe('a%20b');
    });

    test('特殊字符编码', () => {
      const r = encodeTools.urlEncode('a&b=c');
      expect(r).toContain('%26');
      expect(r).toContain('%3D');
    });

    test('空字符串', () => {
      expect(encodeTools.urlEncode('')).toBe('');
    });
  });

  describe('urlDecode', () => {
    test('中文解码', () => {
      expect(encodeTools.urlDecode('%E4%BD%A0%E5%A5%BD')).toBe('你好');
    });

    test('空格解码', () => {
      expect(encodeTools.urlDecode('a%20b')).toBe('a b');
    });

    test('无效编码返回错误信息', () => {
      const r = encodeTools.urlDecode('%ZZ');
      expect(r).toBe('无效的URL编码');
    });

    test('回环测试', () => {
      const original = 'Hello 世界!@#';
      const encoded = encodeTools.urlEncode(original);
      const decoded = encodeTools.urlDecode(encoded);
      expect(decoded).toBe(original);
    });
  });

  describe('hasUrlEncode', () => {
    test('含 URL 编码', () => {
      expect(encodeTools.hasUrlEncode('%E4%BD%A0')).toBe(true);
    });

    test('不含 URL 编码', () => {
      expect(encodeTools.hasUrlEncode('Hello')).toBe(false);
    });

    test('空格不是 %20 不算编码', () => {
      expect(encodeTools.hasUrlEncode('Hello World')).toBe(false);
    });

    test('空字符串', () => {
      expect(encodeTools.hasUrlEncode('')).toBe(false);
    });
  });
});

describe('encodeTools - Unicode', () => {
  describe('unicodeEncode', () => {
    test('中文转 Unicode', () => {
      const r = encodeTools.unicodeEncode('你好');
      expect(r).toBe('\\u4f60\\u597d');
    });

    test('英文不转换', () => {
      expect(encodeTools.unicodeEncode('Hello')).toBe('Hello');
    });

    test('混合文本', () => {
      const r = encodeTools.unicodeEncode('AB测试');
      expect(r).toBe('AB\\u6d4b\\u8bd5');
    });

    test('空字符串', () => {
      expect(encodeTools.unicodeEncode('')).toBe('');
    });
  });

  describe('unicodeDecode', () => {
    test('Unicode 转中文', () => {
      expect(encodeTools.unicodeDecode('\\u4f60\\u597d')).toBe('你好');
    });

    test('混合解码', () => {
      expect(encodeTools.unicodeDecode('AB\\u6d4b\\u8bd5')).toBe('AB测试');
    });

    test('回环测试', () => {
      const original = '你好世界';
      const encoded = encodeTools.unicodeEncode(original);
      const decoded = encodeTools.unicodeDecode(encoded);
      expect(decoded).toBe(original);
    });

    test('不含 Unicode 编码的原样返回', () => {
      expect(encodeTools.unicodeDecode('Hello')).toBe('Hello');
    });

    test('空字符串', () => {
      expect(encodeTools.unicodeDecode('')).toBe('');
    });
  });

  describe('hasUnicode', () => {
    test('含 Unicode 编码', () => {
      expect(encodeTools.hasUnicode('\\u4f60\\u597d')).toBe(true);
    });

    test('不含 Unicode 编码', () => {
      expect(encodeTools.hasUnicode('Hello')).toBe(false);
    });

    test('大写十六进制', () => {
      expect(encodeTools.hasUnicode('\\u4F60')).toBe(true);
    });
  });
});

describe('encodeTools - HTML 实体', () => {
  describe('htmlEncode', () => {
    test('& 编码', () => {
      expect(encodeTools.htmlEncode('A&B')).toBe('A&amp;B');
    });

    test('< 编码', () => {
      expect(encodeTools.htmlEncode('<div>')).toBe('&lt;div&gt;');
    });

    test('引号编码', () => {
      expect(encodeTools.htmlEncode('"hello"')).toBe('&quot;hello&quot;');
    });

    test('空字符串', () => {
      expect(encodeTools.htmlEncode('')).toBe('');
    });

    test('无特殊字符的不变', () => {
      expect(encodeTools.htmlEncode('Hello World')).toBe('Hello World');
    });
  });

  describe('htmlDecode', () => {
    test('&amp; 解码', () => {
      expect(encodeTools.htmlDecode('A&amp;B')).toBe('A&B');
    });

    test('&lt; &gt; 解码', () => {
      expect(encodeTools.htmlDecode('&lt;div&gt;')).toBe('<div>');
    });

    test('&quot; 解码', () => {
      expect(encodeTools.htmlDecode('&quot;hi&quot;')).toBe('"hi"');
    });

    test('&nbsp; 解码', () => {
      expect(encodeTools.htmlDecode('a&nbsp;b')).toBe('a b');
    });

    test('&#39; 解码', () => {
      expect(encodeTools.htmlDecode('it&#39;s')).toBe("it's");
    });

    test('回环测试', () => {
      const original = '<div class="test">A&B\'s</div>';
      const encoded = encodeTools.htmlEncode(original);
      // htmlEncode 只转义 & < > "，单引号原样保留，解码后应与原文完全一致
      const decoded = encodeTools.htmlDecode(encoded);
      expect(decoded).toBe(original);
    });

    test('空字符串', () => {
      expect(encodeTools.htmlDecode('')).toBe('');
    });
  });

  describe('hasHtmlEntity', () => {
    test('含 HTML 实体', () => {
      expect(encodeTools.hasHtmlEntity('a&amp;b')).toBe(true);
    });

    test('不含 HTML 实体', () => {
      expect(encodeTools.hasHtmlEntity('Hello')).toBe(false);
    });

    test('所有支持实体', () => {
      expect(encodeTools.hasHtmlEntity('&amp;')).toBe(true);
      expect(encodeTools.hasHtmlEntity('&lt;')).toBe(true);
      expect(encodeTools.hasHtmlEntity('&gt;')).toBe(true);
      expect(encodeTools.hasHtmlEntity('&quot;')).toBe(true);
      expect(encodeTools.hasHtmlEntity('&#39;')).toBe(true);
      expect(encodeTools.hasHtmlEntity('&nbsp;')).toBe(true);
    });
  });
});

describe('computeAllEncodeResults', () => {
  test('普通文本返回所有编码结果', () => {
    const results = computeAllEncodeResults('Hello');
    expect(results).toHaveProperty('base64Encode');
    expect(results).toHaveProperty('urlEncode');
    expect(results).toHaveProperty('unicodeEncode');
    expect(results).toHaveProperty('htmlEncode');
    expect(results.base64Encode).toBe('SGVsbG8=');
    expect(results.urlEncode).toBe('Hello');
  });

  test('Base64 输入同时包含 base64Decode', () => {
    const results = computeAllEncodeResults('SGVsbG8=');
    expect(results).toHaveProperty('base64Decode');
    expect(results.base64Decode).toBe('Hello');
  });

  test('URL 编码输入同时包含 urlDecode', () => {
    const results = computeAllEncodeResults('%E4%BD%A0%E5%A5%BD');
    expect(results).toHaveProperty('urlDecode');
    expect(results.urlDecode).toBe('你好');
  });

  test('Unicode 编码输入同时包含 unicodeDecode', () => {
    const results = computeAllEncodeResults('\\u4f60\\u597d');
    expect(results).toHaveProperty('unicodeDecode');
  });

  test('HTML 实体输入同时包含 htmlDecode', () => {
    const results = computeAllEncodeResults('a&amp;b');
    expect(results).toHaveProperty('htmlDecode');
  });

  test('中文输入', () => {
    const results = computeAllEncodeResults('你好');
    expect(results.unicodeEncode).toBe('\\u4f60\\u597d');
    expect(results.urlEncode).toBe('%E4%BD%A0%E5%A5%BD');
  });

  test('空字符串', () => {
    const results = computeAllEncodeResults('');
    expect(results.base64Encode).toBe('');
    expect(results.urlEncode).toBe('');
    expect(results.htmlEncode).toBe('');
  });

  test('不含任何解码触发条件时不包含解码字段', () => {
    const results = computeAllEncodeResults('Hello World');
    expect(results).not.toHaveProperty('base64Decode');
    expect(results).not.toHaveProperty('urlDecode');
    expect(results).not.toHaveProperty('unicodeDecode');
    expect(results).not.toHaveProperty('htmlDecode');
  });
});

describe('encodeResultsToList', () => {
  test('所有结果非空时返回8项', () => {
    const results = {
      base64Encode: 'SGVsbG8=',
      base64Decode: 'Hello',
      urlEncode: 'Hello',
      urlDecode: 'Hello',
      unicodeEncode: '\\u0048\\u0065\\u006c\\u006c\\u006f',
      unicodeDecode: 'Hello',
      htmlEncode: 'Hello',
      htmlDecode: 'Hello'
    };
    const list = encodeResultsToList(results);
    expect(list.length).toBe(8);
  });

  test('过滤掉 undefined 值', () => {
    const results = {
      base64Encode: 'SGVsbG8=',
      base64Decode: undefined,
      urlEncode: 'Hello',
      urlDecode: undefined,
      unicodeEncode: 'Hello',
      unicodeDecode: undefined,
      htmlEncode: 'Hello',
      htmlDecode: undefined
    };
    const list = encodeResultsToList(results);
    expect(list.length).toBe(4);
  });

  test('过滤掉空字符串', () => {
    const results = {
      base64Encode: '',
      urlEncode: 'Hello',
      unicodeEncode: '',
      htmlEncode: 'World'
    };
    const list = encodeResultsToList(results);
    expect(list.length).toBe(2);
  });

  test('返回项包含 key, label, value', () => {
    const results = { base64Encode: 'abc', urlEncode: 'def' };
    const list = encodeResultsToList(results);
    expect(list[0]).toEqual({ key: 'base64Encode', label: 'Base64 编码', value: 'abc' });
    expect(list[1]).toEqual({ key: 'urlEncode', label: 'URL 编码', value: 'def' });
  });

  test('HTML 编码标签正确', () => {
    const results = { htmlEncode: '&lt;test&gt;' };
    const list = encodeResultsToList(results);
    expect(list[0].label).toBe('HTML 实体编码');
  });
});
