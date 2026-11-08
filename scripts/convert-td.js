// 一次性脚本：tool.js 的 wx.showToast → TDesign Toast；纯提示 modal → Dialog.alert
const fs = require('fs');
const p = 'pages/tool/tool.js';
let t = fs.readFileSync(p, 'utf8');

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
    blocks.push({ text: src.slice(start, end + 1), start, end: end + 1 });
    idx = end;
  }
  return blocks;
}

// 从块文本中提取参数表达式（title / icon / duration）
function getArg(block, key) {
  const m = block.match(new RegExp(key + '\\s*:\\s*([\\s\\S]+?)(,\\s*(title|icon|duration|mask|success)\\s*:|[}\\]])'));
  return m ? m[1].trim() : null;
}

const THEME = { success: "theme: 'success'", error: "theme: 'error'", loading: "theme: 'loading'" };

// 1) showToast 全量转换（已确认无 success 回调）
const toasts = extractBlocks(t, 'wx.showToast');
let converted = 0, skipped = 0;
// 从后往前替换避免偏移失效
for (let i = toasts.length - 1; i >= 0; i--) {
  const b = toasts[i];
  const title = getArg(b.text, 'title');
  const icon = getArg(b.text, 'icon');
  const duration = getArg(b.text, 'duration');
  if (!title) { skipped++; continue; }
  const parts = ['context: this', "selector: '#t-toast'", 'message: ' + title];
  if (icon && THEME[icon.replace(/['"]/g, '')]) parts.push(THEME[icon.replace(/['"]/g, '')]);
  if (duration) parts.push('duration: ' + duration);
  const rep = 'Toast({ ' + parts.join(', ') + ' })';
  t = t.slice(0, b.start) + rep + t.slice(b.end);
  converted++;
}
console.log('showToast 转换:', converted, '处，跳过', skipped, '处');

// 2) 纯提示 modal（showCancel:false 且无 success）→ Dialog.alert
const modals = extractBlocks(t, 'wx.showModal');
let alertN = 0, manualN = 0;
for (let i = modals.length - 1; i >= 0; i--) {
  const b = modals[i];
  if (/success\s*:/.test(b.text)) { manualN++; continue; }   // 交互型，手动改
  if (/editable\s*:/.test(b.text)) { manualN++; continue; }  // 输入型，保留原生
  const title = getArg(b.text, 'title');
  const content = getArg(b.text, 'content');
  if (!title || !content) { manualN++; continue; }
  const rep = 'Dialog.alert({ context: this, selector: \'#t-dialog\', title: ' + title + ', content: ' + content + ' })';
  t = t.slice(0, b.start) + rep + t.slice(b.end);
  alertN++;
}
console.log('showModal → Dialog.alert:', alertN, '处；保留原生/手动:', manualN, '处');

// 3) 顶部引入 TDesign 模块
if (!/tdesign-miniprogram\/toast/.test(t)) {
  t = "const Toast = require('tdesign-miniprogram/toast/index').default;\nconst Dialog = require('tdesign-miniprogram/dialog/index').default;\n" + t;
}

fs.writeFileSync(p, t);
console.log('已写回', p);
