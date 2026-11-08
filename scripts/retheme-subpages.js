// 一次性脚本：扫描次级页面旧配色并统一到墨绿体系
// 范围：pages 下除 home/tool/profile/scan（容器已优化）外的页面
const fs = require('fs');
const skip = ['home', 'tool', 'profile', 'scan', 'decode', 'log'];

// 旧蓝/灰系 → 墨绿系
const MAP = {
  '#1a1a2e': '#14231D',
  '#16233B': '#16352A',
  '#5B7FFF': '#2E5C4B',
  '#7B9FFF': '#2E6B57',
  '#EBF0FF': '#EAF2E9',
  '#EEF2FF': '#EAF2E9',
  '#F5F7FF': '#F1F6F0',
  '#F0F4FF': '#F1F6F0',
  '#F2F3F7': '#F6F8F5',
  '#F7F9FC': '#F5F9F6',
  '#E8ECF2': '#E6EBE6',
  '#E8ECF4': '#EAF2E9',
  '#B4BBC7': '#B4C6B8',
  '#8A93A6': '#8A9A8E',
  '#0D1B2A': '#14231D',
  '#1B3A4B': '#245244'
};

const report = [];

function walk(d) {
  fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    if (e.isDirectory()) { walk(d + '/' + e.name); return; }
    if (!/\.wxss$/.test(e.name)) return;
    const dir = d.split('/').pop();
    if (skip.includes(dir)) return;
    const p = d + '/' + e.name;
    let t = fs.readFileSync(p, 'utf8');
    let n = 0;
    Object.entries(MAP).forEach(([from, to]) => {
      const parts = t.split(from);
      n += parts.length - 1;
      t = parts.join(to);
    });
    if (n) {
      fs.writeFileSync(p, t);
      report.push(p + ': ' + n + ' 处');
    }
  });
}

walk('pages');
walk('package1');
console.log(report.length ? report.join('\n') : '次级页面无旧配色残留');
