/**
 * 互助工具 · 模式配置
 *
 * 两个模式（个人赛 / 车队）的界面规则与状态工厂。
 * 纯数据与纯函数，不依赖页面实例，可在任意环境引用。
 */

const MODE_STATE_CACHE_KEY = 'toolModeStateCache';
const MODE_LABELS = ['个人赛助力', '车队助力'];

/**
 * 两个模式各自独立的界面规则（受助设置弹窗完全由规则渲染）
 * rows: key / label / action / valueFrom / labelFrom / disabled
 */
const MODE_RULES = [
  {
    key: 'solo',
    label: '个人赛助力',
    title: '我的受助设置',
    statusNormal: '受助状态：今天设置的受助人数已安排完，暂不安排新助力。',
    statusPaused: '受助状态：已暂停受助，暂不安排新助力。',
    rows: [
      { key: 'quota', label: '调整剩余受助人数', action: 'adjustQuota', valueFrom: 'quota' },
      { key: 'pause', action: 'togglePause', labelFrom: 'pause' },
      { key: 'invite', label: '撤回未确认邀请', action: 'onInvite' }
    ]
  },
  {
    key: 'team',
    label: '车队助力',
    title: '车队受助设置',
    statusNormal: '受助状态：今日方式已锁定，车队按已安排人数接受助力。',
    statusPaused: '受助状态：已暂停受助，暂不安排新助力。',
    rows: [
      { key: 'quota', label: '调整剩余受助人数', action: 'adjustQuota', valueFrom: 'quota' },
      { key: 'pause', action: 'togglePause', labelFrom: 'pause' },
      { key: 'locked', label: '今日方式已锁定', action: 'onLocked', disabled: true },
      { key: 'carLevel', label: '更新赛车等级', action: 'updateCarLevel', valueFrom: 'carLevel' },
      { key: 'teamInfo', label: '车队编号与成员', action: 'onTeamInfo', valueFrom: 'teamNo' }
    ]
  }
];

/** 按模式解析当天上限：个人赛 10/10，车队 PK 6/6（旧全局字段无法表达差异，不作兜底） */
function resolveLimits(index, tool) {
  const isTeam = index === 1;
  const per = (v, def) => (typeof v === 'number' && v > 0 ? v : def);
  return {
    helpLimit: per(tool && (isTeam ? tool.daily_help_limit_team : tool.daily_help_limit_solo), isTeam ? 6 : 10),
    receiveLimit: per(tool && (isTeam ? tool.daily_receive_limit_team : tool.daily_receive_limit_solo), isTeam ? 6 : 10)
  };
}

/** 每个模式一套独立状态 */
function createModeState(index, tool) {
  const { helpLimit, receiveLimit } = resolveLimits(index, tool);
  return {
    key: index === 0 ? 'solo' : 'team',
    label: MODE_LABELS[index] || `模式${index + 1}`,
    helpLimit,
    receiveLimit,
    helpUsed: 0,
    receiveUsed: 0,
    quota: 1,
    helpQuota: receiveLimit,
    paused: false,
    carLevel: 1,
    teamNo: '—',
    command: '',
    task: null
  };
}

module.exports = {
  MODE_STATE_CACHE_KEY,
  MODE_LABELS,
  MODE_RULES,
  resolveLimits,
  createModeState
};
