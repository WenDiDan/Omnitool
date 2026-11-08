// 一次性脚本：面板配色统一到工具页绿色系
const fs = require('fs');

const MAP = {
  // 主色：亮蓝 → 工具页墨绿
  '#5B7FFF': '#2E5C4B',
  '#5b7fff': '#2E5C4B',
  // 深色底：深蓝黑 → 墨绿黑
  '#1a1a2e': '#14231D',
  '#0D1B2A': '#14231D',
  // 淡蓝底 → 淡绿底
  '#EEF2FF': '#EAF2E9',
  '#EBF0FF': '#EAF2E9',
  '#F5F7FF': '#F1F6F0',
  '#F0F4FF': '#F1F6F0',
  // 面板背景：浅灰 → 工具页浅绿白
  '#f5f6f7': '#F7FBF7',
  '#F5F6F7': '#F7FBF7'
};

['components/scan-panel/scan-panel.wxss', 'components/decode-panel/decode-panel.wxss'].forEach(p => {
  let t = fs.readFileSync(p, 'utf8');
  let n = 0;
  Object.entries(MAP).forEach(([from, to]) => {
    const parts = t.split(from);
    n += parts.length - 1;
    t = parts.join(to);
  });
  fs.writeFileSync(p, t);
  console.log(p, '替换', n, '处');
});
