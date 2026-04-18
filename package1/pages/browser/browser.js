Page({
    data: {
      url: '',
      currentUrl: '',
      canGoBack: false,
      canGoForward: false
    },
  
    onLoad(options) {
      if (options.url) {
        const url = decodeURIComponent(options.url);
        this.setData({
          url: url,
          currentUrl: url
        });
      }
    },
  
    onUrlInput(e) {
      this.setData({ url: e.detail.value });
    },
  
    loadUrl() {
      let url = this.data.url;
      if (!url.startsWith('http')) {
        url = 'https://' + url;
      }
      this.setData({
        currentUrl: url,
        url: url
      });
    },
  
    goBack() {
      const webview = wx.createWebViewContext();
      webview.goBack();
    },
  
    goForward() {
      const webview = wx.createWebViewContext();
      webview.goForward();
    },
  
    refresh() {
      this.setData({
        currentUrl: this.data.currentUrl
      });
    },
  
    onPageLoad() {
      console.log('页面加载完成');
    },
  
    onPageError(e) {
      console.error('页面加载错误', e);
      wx.showToast({ title: '页面加载失败', icon: 'none' });
    }
  });