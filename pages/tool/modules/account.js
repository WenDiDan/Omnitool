/**
 * 互助工具 · 个人中心（登记资料）
 *
 * 通过 Object.assign 合并进 Page，this 指向页面实例。
 * 负责：资料缓存、云端读写、头像选择/上传、封禁提示。
 */

const Toast = require('tdesign-miniprogram/toast/index').default;
const Dialog = require('tdesign-miniprogram/dialog/index').default;

const ACCOUNT_CACHE_KEY = 'toolAccountCache';
const ACCOUNT_CACHE_VERSION = 2; // 编号规则变更时递增，使旧缓存失效

module.exports = {
  accountKey() {
    return (this.data.tool && this.data.tool.tool_key) || 'default';
  },

  /** cloud:// 转可渲染的 https 临时链接，失败则保留原值 */
  resolveAvatar(url) {
    if (!url || url.indexOf('cloud://') !== 0) return Promise.resolve(url || '');
    return wx.cloud.getTempFileURL({
      fileList: [{ fileID: url, maxAge: 0 }]
    }).then((res) => {
      const file = res.fileList && res.fileList[0];
      return (file && file.tempFileURL) || url;
    }).catch(() => url);
  },

  setAvatarPreview(url) {
    this.resolveAvatar(url).then((preview) => {
      this.setData({ avatarPreview: preview });
    });
  },

  restoreAccountCache(key) {
    try {
      const cached = wx.getStorageSync(ACCOUNT_CACHE_KEY);
      // 版本不匹配（旧哈希编号）或结构异常时忽略缓存，等待云端返回正确编号
      if (!cached || cached.version !== ACCOUNT_CACHE_VERSION) return;
      if (cached[key]) {
        this.setData({
          account: cached[key],
          avatarText: (cached[key].tb_nick || '登').charAt(0)
        });
        this.setAvatarPreview(cached[key].avatar_url);
      }
    } catch (e) { /* 忽略 */ }
  },

  loadAccount() {
    wx.cloud.callFunction({
      name: 'coinPkApi',
      data: { action: 'getAccount' },
      success: (res) => {
        const result = res && res.result;
        if (result && result.success) {
          this.applyAccount(result.account);
          if (result.blocked && !this.data.blocked) {
            this.setData({ blocked: true, blockedReason: result.banReason || '' });
          }
        }
      },
      fail: () => { /* 保留本地缓存 */ }
    });
  },

  /** 统一识别云端封禁返回：命中则弹提示并标记页面状态 */
  handleBlocked(result) {
    if (result && result.error === 'ACCOUNT_BLOCKED') {
      this.setData({ blocked: true });
      Toast({
        context: this,
        selector: '#t-toast',
        message: result.message || '账号已被封禁，无法使用互助功能'
      });
      return true;
    }
    return false;
  },

  applyAccount(account) {
    const key = this.accountKey();
    this.setData({
      account: account || null,
      avatarText: (account && account.tb_nick ? account.tb_nick : '登').charAt(0)
    });
    // 云端受助设置回到本地：自定义名额与暂停状态以云端为准
    if (account) {
      if (typeof account.quota_solo === 'number' && account.quota_solo > 0) {
        this._modeStates[0].helpQuota = Math.min(this._modeStates[0].receiveLimit, account.quota_solo);
      }
      if (typeof account.quota_team === 'number' && account.quota_team > 0) {
        this._modeStates[1].helpQuota = Math.min(this._modeStates[1].receiveLimit, account.quota_team);
      }
      if (typeof account.paused_solo === 'boolean') this._modeStates[0].paused = account.paused_solo;
      if (typeof account.paused_team === 'boolean') this._modeStates[1].paused = account.paused_team;
      this.syncCurrent();
    }
    this.setAvatarPreview(account && account.avatar_url);
    try {
      const cached = wx.getStorageSync(ACCOUNT_CACHE_KEY) || {};
      if (cached.version !== ACCOUNT_CACHE_VERSION) {
        Object.keys(cached).forEach(k => delete cached[k]);
        cached.version = ACCOUNT_CACHE_VERSION;
      }
      cached[key] = account || null;
      wx.setStorageSync(ACCOUNT_CACHE_KEY, cached);
    } catch (e) { /* 忽略 */ }
  },

  /** 清除本地资料缓存：清空所有条目但保留版本号，避免旧资料在页面重进时复现 */
  clearAccountCache() {
    try {
      const cached = wx.getStorageSync(ACCOUNT_CACHE_KEY) || {};
      Object.keys(cached).forEach((k) => delete cached[k]);
      cached.version = ACCOUNT_CACHE_VERSION;
      wx.setStorageSync(ACCOUNT_CACHE_KEY, cached);
    } catch (e) {
      console.warn('[tool] 清除资料缓存失败', e);
    }
  },

  openEdit() {
    const a = this.data.account || {};
    this.setData({
      showEdit: true,
      agreed: !!a.tb_nick,
      form: {
        tb_nick: a.tb_nick || '',
        avatar_url: a.avatar_url || '',
        avatarTemp: ''
      }
    });
    this.setAvatarPreview(a.avatar_url);
  },

  closeEdit() {
    this.setData({ showEdit: false });
  },

  noop() {},

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  toggleAgree() {
    this.setData({ agreed: !this.data.agreed });
  },

  showPolicy() {
    Dialog.alert({ context: this, selector: '#t-dialog', title: '资料说明',
      content: '仅登记淘宝显示昵称与可选头像，用于互助时展示给对方核对。请勿填写登录账号、手机号等信息；上传截图前请先遮住账号、订单、手机号等敏感内容。',
      showCancel: false });
  },

  /** 选择头像：本机压缩，上限 10MB */
  chooseAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) {
          Toast({ context: this, selector: '#t-toast', message: '原图不能超过 10MB' });
          return;
        }
        this.setData({
          'form.avatarTemp': file.tempFilePath,
          avatarPreview: file.tempFilePath
        });
      }
    });
  },

  removeAvatar() {
    this.setData({
      'form.avatarTemp': '',
      'form.avatar_url': '',
      avatarPreview: ''
    });
  },

  /** 有新选头像时先上传云存储，再保存资料 */
  uploadAvatarIfNeeded(tempPath) {
    if (!tempPath) return Promise.resolve('');
    const ext = tempPath.split('.').pop() || 'jpg';
    const cloudPath = `tool-avatars/${Date.now()}-${Math.floor(Math.random() * 100000)}.${ext}`;
    return wx.cloud.uploadFile({ cloudPath, filePath: tempPath })
      .then(res => res.fileID || '')
      .catch(() => '');
  },

  saveAccount() {
    const form = this.data.form;
    if (!form.tb_nick.trim()) {
      Toast({ context: this, selector: '#t-toast', message: '请填写淘宝显示昵称' });
      return;
    }
    if (!this.data.agreed) {
      Toast({ context: this, selector: '#t-toast', message: '请先同意资料说明' });
      return;
    }
    if (this.data.saving) return;

    this.setData({ saving: true });
    wx.showLoading({ title: '保存中', mask: true });

    this.uploadAvatarIfNeeded(form.avatarTemp).then((fileID) => {
      const avatar_url = form.avatarTemp ? fileID : form.avatar_url;
      if (form.avatarTemp && !fileID) {
        wx.hideLoading();
        this.setData({ saving: false });
        Toast({ context: this, selector: '#t-toast', message: '头像上传失败，请重试' });
        return;
      }

      wx.cloud.callFunction({
        name: 'coinPkApi',
        data: {
          action: 'saveAccount',
          account: {
            tool_key: this.accountKey(),
            tb_nick: form.tb_nick,
            avatar_url
          }
        },
        success: (res) => {
          const result = res && res.result;
          if (result && result.success) {
            this.applyAccount(result.account);
            this.setData({ showEdit: false });
            Toast({ context: this, selector: '#t-toast', message: '已保存', theme: 'success' });
          } else {
            Toast({ context: this, selector: '#t-toast', message: '保存失败，请重试' });
          }
        },
        fail: () => {
          Toast({ context: this, selector: '#t-toast', message: '云端不可用，请稍后重试' });
        },
        complete: () => {
          wx.hideLoading();
          this.setData({ saving: false });
        }
      });
    });
  }
};
