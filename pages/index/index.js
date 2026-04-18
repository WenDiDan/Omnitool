Page({
    data: {
      inputCode: '',
      decodedResult: null
    },
  
    onLoad(options) {
      if (options.code) {
        this.setData({ inputCode: decodeURIComponent(options.code) });
        this.decode();
      }
    },
  
    onInput(e) {
      this.setData({
        inputCode: e.detail.value,
        decodedResult: null
      });
    },
  
    decode() {
      const code = this.data.inputCode.trim();
      if (!code) {
        wx.showToast({ title: '请输入条码内容', icon: 'none' });
        return;
      }
  
      const result = this.decodeBarcode(code);
      this.setData({ decodedResult: result });
    },
  
    decodeBarcode(code) {
      const result = {
        type: 'Unknown',
        data: code,
        valid: true
      };
  
      // EAN-13
      if (/^\d{13}$/.test(code)) {
        result.type = 'EAN-13';
        result.countryCode = code.substring(0, 3);
        result.manufacturerCode = code.substring(3, 7);
        result.productCode = code.substring(7, 12);
        result.checkDigit = code.substring(12);
        result.country = this.getCountry(code.substring(0, 3));
        result.valid = this.validateEAN13(code);
      }
      // EAN-8
      else if (/^\d{8}$/.test(code)) {
        result.type = 'EAN-8';
        result.countryCode = code.substring(0, 2);
        result.productCode = code.substring(2, 7);
        result.checkDigit = code.substring(7);
        result.valid = this.validateEAN8(code);
      }
      // UPC-A
      else if (/^\d{12}$/.test(code)) {
        result.type = 'UPC-A';
        result.manufacturerCode = code.substring(0, 5);
        result.productCode = code.substring(5, 11);
        result.checkDigit = code.substring(11);
        result.valid = this.validateUPC(code);
      }
      // URL
      else if (/^https?:\/\//.test(code)) {
        result.type = 'URL';
        result.url = code;
      }
      // 纯数字
      else if (/^\d+$/.test(code)) {
        result.type = 'Numeric Code';
      }
  
      return result;
    },
  
    validateEAN13(code) {
      const digits = code.split('').map(Number);
      let sum = 0;
      for (let i = 0; i < 12; i++) {
        sum += digits[i] * (i % 2 === 0 ? 1 : 3);
      }
      const checkDigit = (10 - (sum % 10)) % 10;
      return checkDigit === digits[12];
    },
  
    validateEAN8(code) {
      const digits = code.split('').map(Number);
      let sum = 0;
      for (let i = 0; i < 7; i++) {
        sum += digits[i] * (i % 2 === 0 ? 3 : 1);
      }
      const checkDigit = (10 - (sum % 10)) % 10;
      return checkDigit === digits[7];
    },
  
    validateUPC(code) {
      const digits = code.split('').map(Number);
      let sum = 0;
      for (let i = 0; i < 11; i++) {
        sum += digits[i] * (i % 2 === 0 ? 3 : 1);
      }
      const checkDigit = (10 - (sum % 10)) % 10;
      return checkDigit === digits[11];
    },
  
    getCountry(code) {
      const countries = {
        '690': '中国', '691': '中国', '692': '中国', '693': '中国',
        '694': '中国', '695': '中国', '697': '中国',
        '00': '美国', '01': '美国', '30': '法国', '31': '法国',
        '40': '德国', '41': '德国', '45': '日本', '49': '日本',
        '50': '英国', '51': '英国'
      };
      for (const [prefix, country] of Object.entries(countries)) {
        if (code.startsWith(prefix)) return country;
      }
      return '未知';
    },
  
    copyResult() {
      wx.setClipboardData({
        data: JSON.stringify(this.data.decodedResult, null, 2),
        success: () => {
          wx.showToast({ title: '已复制', icon: 'success' });
        }
      });
    }
  });