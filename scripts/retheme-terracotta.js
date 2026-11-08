// 全站换色：墨绿体系 → 暖赤陶体系（wxss + wxml 内联，大小写不敏感）
const fs = require('fs');

// 颜色映射表（源 → 目标）
const MAP = {
  // 主色家族
  '#2e5c4b': '#C0553D',
  '#2e6b57': '#CB5F47',
  '#245244': '#A8452F',
  '#1f4638': '#9E3F2B',
  // 强调
  '#3d8b7a': '#E8A44C',
  '#6fcfb0': '#F2B04E',
  '#5fa886': '#C97A45',
  // 深色锚点
  '#14231d': '#2B1D18',
  '#16352a': '#3A2A20',
  '#122b22': '#2E2018',
  // 页面底
  '#f7fbf7': '#FDF9F2',
  '#f6f8f5': '#F9F4EB',
  '#f3f6f3': '#F9F4EB',
  '#f2f3f7': '#F9F4EB',
  '#f5f6f7': '#F9F4EB',
  '#f8f9fa': '#FAF6EE',
  // tint 淡底
  '#eaf2e9': '#F3E7D8',
  '#f1f6f0': '#F7EDE2',
  '#e8f3e8': '#F3DFCB',
  '#e8f3ef': '#F3DFCB',
  '#daede2': '#EBD2BC',
  '#ddebe0': '#E9D5BF',
  '#d0e4d6': '#DFC4A8',
  '#e7f1ea': '#F7E9D6',
  '#e9f3eb': '#F7E9D6',
  '#e9f3ee': '#F7E9D6',
  '#edf5ee': '#F7E9D4',
  '#f5f9f6': '#FAF3E8',
  '#f7faf7': '#FBF6EC',
  '#f5f8f5': '#FAF4EA',
  '#faf3e8': '#FAF3E8',
  '#eaf0ea': '#F0E6D8',
  // 边框
  '#e6ebe6': '#EFE3D5',
  '#f0ede0': '#EFE3D5',
  // 绿灰文字
  '#8a9a8e': '#94817A',
  '#7a8b80': '#7D695F',
  '#5b7062': '#8A766C',
  '#9bb0a3': '#B3A29A',
  '#b4c6b8': '#C9B8AB',
  '#c6d4c9': '#D8C7B6',
  '#b4d6c0': '#F0C89A',
  '#8fc4a2': '#E9B168'
};

// rgba 阴影/装饰映射（墨绿系 → 暖系）
const RGBA_MAP = [
  [/rgba\(20,\s*35,\s*29/g, 'rgba(43, 29, 24'],
  [/rgba\(22,\s*53,\s*42/g, 'rgba(58, 42, 32'],
  [/rgba\(46,\s*92,\s*75/g, 'rgba(192, 85, 61'],
  [/rgba\(61,\s*139,\s*122/g, 'rgba(232, 164, 76'],
  [/rgba\(111,\s*207,\s*176/g, 'rgba(242, 176, 78']
];

let report = [];

function processFile(p) {
  let t = fs.readFileSync(p, 'utf8');
  let n = 0;
  // 十六进制：大小写不敏感替换
  Object.entries(MAP).forEach(([from, to]) => {
    const re = new RegExp(from.replace('#', '#'), 'gi');
    const parts = t.match(re);
    if (parts) { n += parts.length; t = t.replace(re, to); }
  });
  RGBA_MAP.forEach(([re, to]) => {
    const parts = t.match(re);
    if (parts) { n += parts.length; t = t.replace(re, to); }
  });
  if (n) {
    fs.writeFileSync(p, t);
    report.push(p + ': ' + n + ' 处');
  }
}

function walk(d) {
  fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    if (e.isDirectory()) {
      if (!['node_modules', 'miniprogram_npm', '.git', 'cloudfunctions', 'tests', 'scripts'].includes(e.name)) walk(d + '/' + e.name);
    } else if (/\.(wxss|wxml)$/.test(e.name)) {
      processFile(d + '/' + e.name);
    }
  });
}

walk('.');
console.log(report.length ? report.join('\n') : '无替换');
