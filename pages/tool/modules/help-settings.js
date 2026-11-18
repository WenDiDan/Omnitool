/**
 * 互助工具 · 受助设置入口
 *
 * 打开/关闭受助设置弹窗、设置项分发、邀请与车队信息、未登记引导。
 * 通过 Object.assign 合并进 Page，this 指向页面实例。
 */

const Toast = require('tdesign-miniprogram/toast/index').default;
const Dialog = require('tdesign-miniprogram/dialog/index').default;

module.exports = {
  openHelpSettings(e) {
    const mode = Number((e && e.currentTarget.dataset.mode) || 0);
    this.setData({ settingsMode: mode, showHelpSettings: true }, () => this.syncCurrent());
  },

  closeHelpSettings() {
    this.setData({ showHelpSettings: false });
  },

  /** 受助设置行点击统一分发 */
  onSettingAction(e) {
    const action = e.currentTarget.dataset.action;
    const handlers = {
      adjustQuota: this.adjustQuota,
      togglePause: this.togglePause,
      onLocked: this.onLocked,
      updateCarLevel: this.updateCarLevel,
      onInvite: this.onInvite,
      onTeamInfo: this.onTeamInfo
    };
    const fn = handlers[action];
    if (typeof fn === 'function') fn.call(this);
  },

  /** 个人赛助力：撤回未确认邀请 */
  onInvite() {
    Toast({ context: this, selector: '#t-toast', message: '暂无未确认邀请' });
  },

  /** 车队助力：查看车队编号与成员 */
  onTeamInfo() {
    const no = this.settingsState().teamNo || '—';
    Dialog.alert({ context: this, selector: '#t-dialog', title: '车队信息',
      content: no === '—' ? '尚未加入车队' : `车队编号：${no}` });
  },

  /** 未登记引导：跳转个人中心登记资料 */
  promptRegister() {
    Dialog.confirm({
      context: this,
      selector: '#t-dialog',
      title: '需要先登记',
      content: '登记昵称与头像后才能参与口令互助，是否前往登记？',
      confirmBtn: '去登记',
      cancelBtn: '取消'
    }).then(() => {
      this.setData({ activeTab: 2 });
    }).catch(() => {});
  },

};
