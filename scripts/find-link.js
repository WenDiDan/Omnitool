// 全项目搜索 ujd6.cn 链接引用（排除 node_modules/miniprogram_npm/云函数依赖目录）
const fs = require('fs');
const hits = [];

function walk(d, depth) {
  if (depth > 4) return;
  let names;
  try { names = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
  names.forEach(e => {
    if (['node_modules', 'miniprogram_npm', '.git', 'tests', 'cloudfunctions'].includes(e.name) && e.isDirectory()) return;
    const p = d + '/' + e.name;
    if (e.isDirectory()) { walk(p, depth + 1); return; }
    if (!/\.(js|json|wxml|wxss|md)$/.test(e.name)) return;
    let t;
    try { t = fs.readFileSync(p, 'utf8'); } catch (err) { return; }
    if (/ujd6\.cn/i.test(t)) {
      t.split('\n').forEach((l, i) => {
        if (/ujd6\.cn/i.test(l)) hits.push(p + ':' + (i + 1) + ': ' + l.trim().slice(0, 140));
      });
    }
  });
}

walk('.', 0);
console.log(hits.length ? hits.join('\n') : '未找到');
