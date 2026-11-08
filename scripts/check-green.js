// 全站绿色/墨绿残留终检
const fs = require('fs');
const left = ['#2E5C4B', '#3D8B7A', '#6FCFB0', '#14231D', '#16352A', '#EAF2E9', '#F7FBF7', '#E6EBE6', '#2E6B57', '#245244', '#5FA886'];
const bad = [];
function walk(d) {
  fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    if (e.isDirectory()) {
      if (!['node_modules', 'miniprogram_npm', '.git', 'cloudfunctions', 'tests', 'scripts'].includes(e.name)) walk(d + '/' + e.name);
    } else if (/\.(wxss|wxml|js|json)$/.test(e.name) && !['package.json', 'package-lock.json'].includes(e.name)) {
      const t = fs.readFileSync(d + '/' + e.name, 'utf8');
      left.forEach(c => { if (t.toLowerCase().includes(c.toLowerCase())) bad.push(d + '/' + e.name + ' 含 ' + c); });
    }
  });
}
walk('pages'); walk('components'); walk('package1'); walk('utils'); walk('.');
['app.wxss', 'app.json', 'app.js'].forEach(p => { if (fs.existsSync(p)) { const t = fs.readFileSync(p, 'utf8'); left.forEach(c => { if (t.toLowerCase().includes(c.toLowerCase())) bad.push(p + ' 含 ' + c); }); } });
console.log(bad.length ? bad.join('\n') : '全站绿色残留清零');
