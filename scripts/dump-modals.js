// dump 全部 modal 块 + 检查 function() 回调内 this 风险
const fs = require('fs');
const t = fs.readFileSync('pages/tool/tool.js', 'utf8');

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
    blocks.push({ text: src.slice(start, end + 1), at: start });
    idx = end;
  }
  return blocks;
}

extractBlocks(t, 'wx.showModal').forEach((m, i) => {
  console.log('--- modal[' + i + '] @' + m.at);
  console.log(m.text.replace(/\s+/g, ' ').slice(0, 400));
});

// showToast 是否位于 function(){ } 内（this 风险）
const fnCount = (t.match(/function\s*\(/g) || []).length;
console.log('\nfunction() 回调数量:', fnCount);
