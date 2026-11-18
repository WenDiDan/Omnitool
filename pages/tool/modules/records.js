/**
 * 互助工具 · 记录页方法
 *
 * 通过 Object.assign 合并进 Page，this 指向页面实例。
 * 负责：拉取记录、类型/状态筛选、分组展示、详情查看。
 */

const Toast = require('tdesign-miniprogram/toast/index').default;
const Dialog = require('tdesign-miniprogram/dialog/index').default;

const STATUS_TEXT = { ongoing: '进行中', pending: '待核对', done: '已成功', returned: '已放回' };
const WEEK_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 记录列表 → 按日期分组（新→旧），用于历史浏览 */
function groupByDate(records) {
  const groups = {};
  records.forEach((r) => {
    if (!groups[r.date]) groups[r.date] = [];
    groups[r.date].push(r);
  });
  return Object.keys(groups).sort().reverse().map((date) => {
    const d = new Date(date + 'T00:00:00+08:00');
    const thisYear = new Date().getFullYear() === d.getFullYear();
    const dateText = (thisYear ? '' : d.getFullYear() + '年')
      + (d.getMonth() + 1) + '月' + d.getDate() + '日 · ' + WEEK_LABELS[d.getDay()];
    return { date, dateText, list: groups[date] };
  });
}

module.exports = {
  /** 记录页：从云端拉取互助记录（助人/受助，跨天保留，最近 50 条） */
  loadRecords() {
    const mode = this.data.activeMode === 0 ? 'solo' : 'team';
    this.setData({ recordsLoading: true });
    wx.cloud.callFunction({
      name: 'coinPkApi',
      data: {
        action: 'getRecords',
        tool_key: this.modeStateKey(),
        mode,
        type: this.data.recordType
      },
      success: (r) => {
        const result = r && r.result;
        if (!result || !result.success) {
          this.setData({ recordsLoading: false, recordsList: [] });
          return;
        }
        const filter = this.data.recordFilter;
        const all = (result.records || []).map((record) => ({
          id: record._id,
          nick: record.nick,
          command: record.command,
          date: record.date,
          time: (record.created_at || '').slice(11, 16),
          status: record.status,
          statusText: STATUS_TEXT[record.status] || record.status
        }));
        // 各状态计数（与筛选无关，始终基于全量）
        const recordCounts = {
          all: all.length,
          done: all.filter((r) => r.status === 'done').length,
          pending: all.filter((r) => r.status === 'pending').length,
          returned: all.filter((r) => r.status === 'returned').length,
          ongoing: all.filter((r) => r.status === 'ongoing').length
        };
        const list = all.filter((r) => (filter === 'all' ? true : r.status === filter));
        this.setData({
          recordsLoading: false,
          recordsList: list,
          recordGroups: groupByDate(all),
          recordCounts
        });
      },
      fail: () => {
        this.setData({ recordsLoading: false, recordsList: [] });
        Toast({ context: this, selector: '#t-toast', message: '记录加载失败，请重试' });
      }
    });
  },

  setRecordType(e) {
    const t = e.currentTarget.dataset.t;
    if (t === this.data.recordType) return;
    this.setData({ recordType: t, recordFilter: 'all' }, () => this.loadRecords());
  },

  setRecordFilter(e) {
    this.setData({ recordFilter: e.currentTarget.dataset.f }, () => this.loadRecords());
  },

  /** 查看记录详情：完整口令，可复制 */
  viewRecordDetail(e) {
    const id = e.currentTarget.dataset.id;
    const record = this.data.recordsList.find((r) => r.id === id);
    if (!record) return;
    Dialog.confirm({
      context: this,
      selector: '#t-dialog',
      title: '互助详情',
      content: [
        '对象：' + record.nick,
        '口令：' + (record.command || '未记录'),
        '时间：' + record.date + ' ' + (record.time || '')
      ].join('\n'),
      confirmBtn: '复制口令',
      cancelBtn: '关闭'
    }).then(() => {
      if (record.command) {
        wx.setClipboardData({
          data: record.command,
          success: () => Toast({ context: this, selector: '#t-toast', message: '口令已复制', theme: 'success' })
        });
      }
    }).catch(() => {});
  }
};
