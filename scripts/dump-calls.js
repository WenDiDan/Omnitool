// dump tool.js 中 showToast/showModal 调用块样本
const fs = require('fs');
const t = fs.readFileSync('pages/tool/tool.js', 'utf8');

// 简单提取每个 wx.showToast({...}) / wx.showModal({...}) 块
function extractBlocks(src, name) {
  const blocks = [];
  let idx = 0;
  while (true) {
    const start = src.indexOf(name + '({', idx);
    if (start === -1) break;
    let depth = 0, end = start + name.length;
    for (let i = start + name.length; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    blocks.push(src.slice(start, end + 1));
    idx = end;
  }
  return blocks;
}

const toasts = extractBlocks(t, 'wx.showToast');
const modals = extractBlocks(t, 'wx.showModal');
console.log('== showToast 块数:', toasts.length);
const hasSuccess = toasts.filter(b => /success\s*:/.test(b)).length;
const hasHide = (t.match(/wx\.hideToast/g) || []).length;
console.log('  含 success 回调:', hasSuccess, '| wx.hideToast:', hasHide);
console.log('  样本1:', toasts[0]);
console.log('  样本2:', toasts[1] || '(无)');
console.log('== showModal 块数:', modals.length);
modals.slice(0, 3).forEach((m, i) => console.log('  modal[' + i + ']:', m.replace(/\s+/g, ' ').slice(0, 200)));
// js 顶部
console.log('== js 头 8 行:');
console.log(t.split('\n').slice(0, 8).join('\n'));
