// 找出被截断的模板串：message:/content: 中 ${ 后缺 }
const fs = require('fs');
const t = fs.readFileSync('pages/tool/tool.js', 'utf8');
const lines = t.split('\n');
lines.forEach((l, i) => {
  // 模板串内出现 ${ 但该行没有匹配的 }
  if (/`[^`]*\$\{[^}`]*$/.test(l) && !/\$\{[^}]*\}/.test(l.slice(l.indexOf('${')))) {
    console.log((i + 1) + ': ' + l.trim());
  }
  // Toast/Dialog 调用行内出现两层 ${（截断复制的特征）
  if (/Toast\(\{|Dialog\./.test(l)) {
    const ticks = (l.match(/`/g) || []).length;
    if (ticks % 2 === 1) console.log('反引号奇数 @' + (i + 1) + ': ' + l.trim());
  }
});
console.log('scan done');
