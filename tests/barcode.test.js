/**
 * barcode.js 单元测试
 * 覆盖 identifyBarcodeType, decodeBarcode, isActionable,
 * parseWifi, parseVCard, validateEAN13, validateEAN8, validateUPC, getCountry
 */

const barcode = require('../utils/barcode.js');

describe('identifyBarcodeType', () => {
  test('通过 wxScanType 识别 QR_CODE', () => {
    expect(barcode.identifyBarcodeType('https://example.com', 'QR_CODE')).toBe('二维码');
  });

  test('通过 wxScanType 识别 EAN_13', () => {
    expect(barcode.identifyBarcodeType('6901234567890', 'EAN_13')).toBe('EAN-13');
  });

  test('EAN_13 带 978 前缀识别为 ISBN', () => {
    expect(barcode.identifyBarcodeType('9783161484100', 'EAN_13')).toBe('ISBN');
  });

  test('EAN_13 带 979 前缀识别为 ISBN', () => {
    expect(barcode.identifyBarcodeType('9790201379624', 'EAN_13')).toBe('ISBN');
  });

  test('通过 wxScanType 识别 EAN_8', () => {
    expect(barcode.identifyBarcodeType('12345670', 'EAN_8')).toBe('EAN-8');
  });

  test('通过 wxScanType 识别 CODE_128', () => {
    expect(barcode.identifyBarcodeType('ABC123', 'CODE_128')).toBe('Code 128');
  });

  test('通过 wxScanType 识别 CODE_39', () => {
    expect(barcode.identifyBarcodeType('ABC', 'CODE_39')).toBe('Code 39');
  });

  test('通过 wxScanType 识别 CODE_93', () => {
    expect(barcode.identifyBarcodeType('TEST', 'CODE_93')).toBe('Code 93');
  });

  test('通过 wxScanType 识别 CODABAR', () => {
    expect(barcode.identifyBarcodeType('1234', 'CODABAR')).toBe('Codabar码');
  });

  test('通过 wxScanType 识别 ITF', () => {
    expect(barcode.identifyBarcodeType('1234', 'ITF')).toBe('ITF');
  });

  test('通过 wxScanType 识别 PDF_417', () => {
    expect(barcode.identifyBarcodeType('data', 'PDF_417')).toBe('PDF417');
  });

  test('通过 wxScanType 识别 DATA_MATRIX', () => {
    expect(barcode.identifyBarcodeType('data', 'DATA_MATRIX')).toBe('Data Matrix');
  });

  test('通过 wxScanType 识别 AZTEC', () => {
    expect(barcode.identifyBarcodeType('data', 'AZTEC')).toBe('Aztec码');
  });

  test('通过 wxScanType 识别 UPC_A', () => {
    expect(barcode.identifyBarcodeType('123456789012', 'UPC_A')).toBe('UPC-A');
  });

  test('通过 wxScanType 识别 UPC_E', () => {
    expect(barcode.identifyBarcodeType('12345678', 'UPC_E')).toBe('UPC-E');
  });

  test('通过 wxScanType 识别 MAXI_CODE', () => {
    expect(barcode.identifyBarcodeType('data', 'MAXI_CODE')).toBe('MaxiCode');
  });

  test('通过 wxScanType 识别 RSS_14', () => {
    expect(barcode.identifyBarcodeType('data', 'RSS_14')).toBe('RSS 14');
  });

  test('通过 wxScanType 识别 RSS_EXPANDED', () => {
    expect(barcode.identifyBarcodeType('data', 'RSS_EXPANDED')).toBe('RSS Expanded');
  });

  test('通过 wxScanType 识别 UPC_EAN_EXTENSION', () => {
    expect(barcode.identifyBarcodeType('data', 'UPC_EAN_EXTENSION')).toBe('UPC/EAN扩展');
  });

  test('未知 wxScanType 返回 undefined 时走规则匹配', () => {
    expect(barcode.identifyBarcodeType('data', 'UNKNOWN_TYPE')).toBe('文本');
  });

  // --- 无 wxScanType 的规则匹配 ---

  test('WIFI: 前缀识别为 WiFi二维码', () => {
    expect(barcode.identifyBarcodeType('WIFI:T:WPA;S:MyNet;;')).toBe('WiFi二维码');
  });

  test('BEGIN:VCARD 识别为 vCard名片', () => {
    expect(barcode.identifyBarcodeType('BEGIN:VCARD\nFN:张三\nEND:VCARD')).toBe('vCard名片');
  });

  test('mailto: 前缀识别为邮箱', () => {
    expect(barcode.identifyBarcodeType('mailto:test@example.com')).toBe('邮箱');
  });

  test('tel: 前缀识别为电话', () => {
    expect(barcode.identifyBarcodeType('tel:13800138000')).toBe('电话');
  });

  test('smsto: 前缀识别为短信', () => {
    expect(barcode.identifyBarcodeType('smsto:13800138000')).toBe('短信');
  });

  test('13位纯数字识别为 EAN-13', () => {
    expect(barcode.identifyBarcodeType('6901234567890')).toBe('EAN-13');
  });

  test('13位纯数字以 978 开头识别为 ISBN', () => {
    expect(barcode.identifyBarcodeType('9783161484100')).toBe('ISBN');
  });

  test('12位纯数字识别为 UPC-A', () => {
    expect(barcode.identifyBarcodeType('123456789012')).toBe('UPC-A');
  });

  test('8位纯数字识别为 EAN-8', () => {
    expect(barcode.identifyBarcodeType('12345670')).toBe('EAN-8');
  });

  test('https URL 识别为 URL', () => {
    expect(barcode.identifyBarcodeType('https://example.com/path')).toBe('URL');
  });

  test('http URL 识别为 URL', () => {
    expect(barcode.identifyBarcodeType('http://example.com')).toBe('URL');
  });

  test('纯数字字符串识别为数字条码', () => {
    expect(barcode.identifyBarcodeType('123456789')).toBe('数字条码');
  });

  test('普通文本识别为文本', () => {
    expect(barcode.identifyBarcodeType('Hello World')).toBe('文本');
  });

  test('空字符串识别为文本', () => {
    expect(barcode.identifyBarcodeType('')).toBe('文本');
  });

  test('混合字符识别为文本', () => {
    expect(barcode.identifyBarcodeType('abc123@#$')).toBe('文本');
  });
});

describe('decodeBarcode', () => {
  describe('EAN-13 (非ISBN)', () => {
    const valid = '6901234567890';
    const result = barcode.decodeBarcode(valid);

    test('类型为 EAN-13', () => {
      expect(result.type).toBe('EAN-13');
    });

    test('包含国家码', () => {
      expect(result.countryCode).toBe('690');
    });

    test('包含制造商码', () => {
      expect(result.manufacturerCode).toBe('1234');
    });

    test('包含产品码', () => {
      expect(result.productCode).toBe('56789');
    });

    test('包含校验位', () => {
      expect(result.checkDigit).toBe('0');
    });

    test('国家为中国', () => {
      expect(result.country).toBe('中国');
    });

    test('有效 EAN-13 valid 为 false（假校验位）', () => {
      expect(result.valid).toBe(false); // 6901234567890 has wrong check digit
    });

    test('length 为 13', () => {
      expect(result.length).toBe(13);
    });
  });

  describe('有效 EAN-13 校验位', () => {
    test('9783161484100 校验通过', () => {
      // Known valid ISBN-13: 978-3-16-148410-0
      const r = barcode.decodeBarcode('9783161484100', 'EAN_13');
      expect(r.type).toBe('ISBN');
      expect(r.valid).toBe(true);
    });

    test('4901234567894 校验通过', () => {
      // Known valid EAN-13 from Japan
      const r = barcode.decodeBarcode('4901234567894');
      expect(r.valid).toBe(true);
    });
  });

  describe('EAN-8', () => {
    test('类型为 EAN-8', () => {
      const r = barcode.decodeBarcode('12345670');
      expect(r.type).toBe('EAN-8');
      expect(r.countryCode).toBe('12');
      expect(r.productCode).toBe('34567');
      expect(r.checkDigit).toBe('0');
      expect(r.length).toBe(8);
    });
  });

  describe('UPC-A', () => {
    test('类型为 UPC-A', () => {
      const r = barcode.decodeBarcode('123456789012');
      expect(r.type).toBe('UPC-A');
      expect(r.manufacturerCode).toBe('12345');
      expect(r.productCode).toBe('678901');
      expect(r.checkDigit).toBe('2');
      expect(r.length).toBe(12);
    });
  });

  describe('URL', () => {
    test('https URL 解析域名', () => {
      const r = barcode.decodeBarcode('https://www.example.com/path?q=1');
      expect(r.type).toBe('URL');
      expect(r.url).toBe('https://www.example.com/path?q=1');
      expect(r.domain).toBe('www.example.com');
    });

    test('http URL 解析域名', () => {
      const r = barcode.decodeBarcode('http://example.com');
      expect(r.domain).toBe('example.com');
    });
  });

  describe('WiFi', () => {
    const wifiCode = 'WIFI:T:WPA;S:MyHome;P:pass123;H:true;;';
    const r = barcode.decodeBarcode(wifiCode);

    test('类型为 WiFi二维码', () => {
      expect(r.type).toBe('WiFi二维码');
    });

    test('SSID 正确', () => {
      expect(r.ssid).toBe('MyHome');
    });

    test('加密方式正确', () => {
      expect(r.encryption).toBe('WPA');
    });

    test('密码正确', () => {
      expect(r.password).toBe('pass123');
    });

    test('隐藏网络标记为 true', () => {
      expect(r.hidden).toBe(true);
    });
  });

  describe('vCard', () => {
    const vcf = 'BEGIN:VCARD\nVERSION:3.0\nFN:张三\nTEL;TYPE=CELL:13800138000\nEMAIL:zhangsan@example.com\nORG:ABC公司\nEND:VCARD';
    const r = barcode.decodeBarcode(vcf);

    test('类型为 vCard名片', () => {
      expect(r.type).toBe('vCard名片');
    });
    test('姓名正确', () => { expect(r.vcardName).toBe('张三'); });
    test('电话正确', () => { expect(r.vcardPhone).toBe('13800138000'); });
    test('邮箱正确', () => { expect(r.vcardEmail).toBe('zhangsan@example.com'); });
    test('组织正确', () => { expect(r.vcardOrg).toBe('ABC公司'); });
  });

  describe('邮箱', () => {
    test('mailto 解析', () => {
      const r = barcode.decodeBarcode('mailto:test@test.com');
      expect(r.type).toBe('邮箱');
      expect(r.email).toBe('test@test.com');
    });
  });

  describe('电话', () => {
    test('tel 解析', () => {
      const r = barcode.decodeBarcode('tel:13800138000');
      expect(r.type).toBe('电话');
      expect(r.phone).toBe('13800138000');
    });
  });

  describe('短信', () => {
    test('smsto 解析', () => {
      const r = barcode.decodeBarcode('smsto:13800138000:Hello');
      expect(r.type).toBe('短信');
      expect(r.smsPhone).toBe('13800138000');
      expect(r.smsBody).toBe('Hello');
    });

    test('smsto 无消息体', () => {
      const r = barcode.decodeBarcode('smsto:13800138000');
      expect(r.smsPhone).toBe('13800138000');
      expect(r.smsBody).toBe('');
    });
  });

  describe('纯数字', () => {
    test('9位数字识别为数字条码', () => {
      const r = barcode.decodeBarcode('123456789');
      expect(r.type).toBe('数字条码');
      expect(r.valid).toBe(true);
    });
  });

  describe('文本', () => {
    test('普通文本', () => {
      const r = barcode.decodeBarcode('ABC-123');
      expect(r.type).toBe('文本');
      expect(r.valid).toBe(true);
      expect(r.length).toBe(7);
    });
  });

  describe('边界情况', () => {
    test('空字符串', () => {
      const r = barcode.decodeBarcode('');
      expect(r.type).toBe('文本');
      expect(r.length).toBe(0);
      expect(r.valid).toBe(true);
    });

    test('非常长的文本', () => {
      const long = 'A'.repeat(10000);
      const r = barcode.decodeBarcode(long);
      expect(r.type).toBe('文本');
      expect(r.length).toBe(10000);
    });

    test('WIFI 不带协议后缀', () => {
      const r = barcode.decodeBarcode('WIFI:S:net;P:pw;;');
      expect(r.type).toBe('WiFi二维码');
      expect(r.ssid).toBe('net');
    });
  });
});

describe('isActionable', () => {
  test('https URL 返回 url', () => {
    expect(barcode.isActionable('https://example.com')).toBe('url');
  });

  test('http URL 返回 url', () => {
    expect(barcode.isActionable('http://test.com')).toBe('url');
  });

  test('WIFI 返回 wifi', () => {
    expect(barcode.isActionable('WIFI:S:n;P:p;;')).toBe('wifi');
  });

  test('tel 返回 phone', () => {
    expect(barcode.isActionable('tel:12345')).toBe('phone');
  });

  test('mailto 返回 email', () => {
    expect(barcode.isActionable('mailto:a@b.com')).toBe('email');
  });

  test('普通文本返回 null', () => {
    expect(barcode.isActionable('Hello')).toBeNull();
  });

  test('EAN-13 返回 null', () => {
    expect(barcode.isActionable('6901234567890')).toBeNull();
  });

  test('空字符串返回 null', () => {
    expect(barcode.isActionable('')).toBeNull();
  });
});

describe('parseWifi', () => {
  test('完整 WiFi 字符串解析', () => {
    const r = barcode.parseWifi('WIFI:T:WPA2;S:HomeNet;P:secret123;H:false;;');
    expect(r.encryption).toBe('WPA2');
    expect(r.ssid).toBe('HomeNet');
    expect(r.password).toBe('secret123');
    expect(r.hidden).toBe(false);
  });

  test('H:true 正确识别', () => {
    const r = barcode.parseWifi('WIFI:T:WEP;S:Net;P:pw;H:true;;');
    expect(r.hidden).toBe(true);
  });

  test('H 值为其他字符串时 hidden 为 false', () => {
    const r = barcode.parseWifi('WIFI:T:WEP;S:Net;P:pw;H:no;;');
    expect(r.hidden).toBe(false);
  });

  test('只有部分字段', () => {
    const r = barcode.parseWifi('WIFI:S:OpenNet;;');
    expect(r.ssid).toBe('OpenNet');
    expect(r.encryption).toBe('');
    expect(r.password).toBe('');
    expect(r.hidden).toBe(false);
  });

  test('空字符串返回默认值', () => {
    const r = barcode.parseWifi('');
    expect(r.ssid).toBe('');
    expect(r.encryption).toBe('');
    expect(r.password).toBe('');
    expect(r.hidden).toBe(false);
  });

  test('密码含特殊字符', () => {
    const r = barcode.parseWifi('WIFI:S:Net;P:a;b=c/d?e;;');
    expect(r.password).toBe('a');
    // Only captures up to first semicolon
  });
});

describe('parseVCard', () => {
  test('完整 vCard 解析', () => {
    const vcf = 'BEGIN:VCARD\nVERSION:3.0\nFN:李四\nTEL;TYPE=CELL:13900001111\nEMAIL:lisi@test.com\nORG:Test Inc.\nEND:VCARD';
    const r = barcode.parseVCard(vcf);
    expect(r.name).toBe('李四');
    expect(r.phone).toBe('13900001111');
    expect(r.email).toBe('lisi@test.com');
    expect(r.org).toBe('Test Inc.');
  });

  test('部分字段', () => {
    const r = barcode.parseVCard('BEGIN:VCARD\nFN:王五\nEND:VCARD');
    expect(r.name).toBe('王五');
    expect(r.phone).toBe('');
    expect(r.email).toBe('');
  });

  test('空字符串', () => {
    const r = barcode.parseVCard('');
    expect(r.name).toBe('');
    expect(r.phone).toBe('');
  });

  test('TEL 无 TYPE 参数', () => {
    const r = barcode.parseVCard('BEGIN:VCARD\nTEL:12345678\nEND:VCARD');
    expect(r.phone).toBe('12345678');
  });
});

describe('validateEAN13', () => {
  test('9783161484100 校验通过', () => {
    expect(barcode.validateEAN13('9783161484100')).toBe(true);
  });

  test('4901234567894 校验通过', () => {
    expect(barcode.validateEAN13('4901234567894')).toBe(true);
  });

  test('6901234567890 校验失败', () => {
    expect(barcode.validateEAN13('6901234567890')).toBe(false);
  });

  test('全零 EAN-13 校验位计算为合法（算法层面）', () => {
    // 全零输入按校验位算法计算通过；业务上是否为真实商品码不在校验函数职责内
    expect(barcode.validateEAN13('0000000000000')).toBe(true);
  });

  test('校验位 0 的正确条码', () => {
    // 5901234123457: 5+0+2+4+2+4+(9+1+3+1+3+5)*3 = 校验
    // Actually let's use a known valid: 5901234123457
    expect(barcode.validateEAN13('5901234123457')).toBe(true);
  });
});

describe('validateEAN8', () => {
  test('已知有效 EAN-8', () => {
    // 12345670: (1+3+5+7)*3 + (2+4+6) = 16*3+12=48+12=60 -> (10-0)%10=0, check=0 ✓
    expect(barcode.validateEAN8('12345670')).toBe(true);
  });

  test('无效 EAN-8', () => {
    expect(barcode.validateEAN8('12345678')).toBe(false);
  });
});

describe('validateUPC', () => {
  test('已知有效 UPC-A: 042100005264', () => {
    // (0+2+0+0+5+6)*3 + (4+1+0+0+2) = 13*3+7=46 -> (10-6)%10=4, check=4 ✓
    expect(barcode.validateUPC('042100005264')).toBe(true);
  });

  test('无效 UPC-A（校验位不符）', () => {
    // 123456789012 的校验位应为 2（即原值本身有效），改末位构造真正无效的样本
    expect(barcode.validateUPC('123456789013')).toBe(false);
  });
});

describe('getCountry', () => {
  test('690 前缀为中国', () => { expect(barcode.getCountry('690')).toBe('中国'); });
  test('691 前缀为中国', () => { expect(barcode.getCountry('691')).toBe('中国'); });
  test('00 前缀为美国', () => { expect(barcode.getCountry('00')).toBe('美国'); });
  test('45 前缀为日本', () => { expect(barcode.getCountry('45')).toBe('日本'); });
  test('50 前缀为英国', () => { expect(barcode.getCountry('50')).toBe('英国'); });
  test('489 前缀为中国香港', () => { expect(barcode.getCountry('489')).toBe('中国香港'); });
  test('471 前缀为中国台湾', () => { expect(barcode.getCountry('471')).toBe('中国台湾'); });
  test('880 前缀为韩国', () => { expect(barcode.getCountry('880')).toBe('韩国'); });
  test('958 前缀为中国澳门', () => { expect(barcode.getCountry('958')).toBe('中国澳门'); });
  test('880 长前缀匹配韩国', () => { expect(barcode.getCountry('8801234')).toBe('韩国'); });
  test('未知前缀返回未知', () => { expect(barcode.getCountry('999')).toBe('未知'); });
  test('空字符串返回未知', () => { expect(barcode.getCountry('')).toBe('未知'); });
});
