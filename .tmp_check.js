const fs = require('fs');
const w = fs.readFileSync('pages/tool/tool.wxml', 'utf8');
const j = fs.readFileSync('pages/tool/tool.js', 'utf8');
const s = fs.readFileSync('pages/tool/tool.wxss', 'utf8');
const names = [...new Set([...w.matchAll(/(?:bindtap|catchtap)="([a-zA-Z]+)"/g)].map(m => m[1]))];
const missing = names.filter(n => !new RegExp('^  ' + n + '\\(', 'm').test(j));
console.log(missing.length ? '缺失方法: ' + missing.join(',') : '绑定全部匹配（' + names.length + '个）');
['hr-confirm', 'hr-actions', 'record-tip', 'hr-status-pending'].forEach(c => {
  console.log(c + ' wxml:' + ((w.match(new RegExp(c, 'g')) || []).length) + ' wxss:' + ((s.match(new RegExp('\\.' + c, 'g')) || []).length));
});
