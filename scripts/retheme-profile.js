// 一次性脚本：profile.wxss 旧蓝系 → 墨绿系；菜单图标彩虹 → 柔和粉彩
const fs = require('fs');
const p = 'pages/profile/profile.wxss';
let t = fs.readFileSync(p, 'utf8');

const MAP = {
  '#1a1a2e': '#14231D',
  '#5B7FFF': '#2E5C4B',
  '#7B9AFF': '#2E6B57',
  '#EBF0FF': '#EAF2E9',
  '#F0F0F0': '#EAF0EA',
  '#F5F5F5': '#F1F6F0',
  '#FAFAFA': '#F7FAF7'
};

let n = 0;
Object.entries(MAP).forEach(([from, to]) => {
  const parts = t.split(from);
  n += parts.length - 1;
  t = parts.join(to);
});

// 菜单图标：彩虹渐变 → 柔和粉彩渐变（多彩但有层次不刺眼）
t = t.replace(/\.icon-blue\s*\{[^}]*\}/, '.icon-blue { background: linear-gradient(135deg, #7FA8E8, #A9C4EF); }');
t = t.replace(/\.icon-green\s*\{[^}]*\}/, '.icon-green { background: linear-gradient(135deg, #6FBF8E, #96D4B0); }');
t = t.replace(/\.icon-orange\s*\{[^}]*\}/, '.icon-orange { background: linear-gradient(135deg, #E8A76F, #F2C49B); }');
t = t.replace(/\.icon-purple\s*\{[^}]*\}/, '.icon-purple { background: linear-gradient(135deg, #A78BD4, #C4AFF0); }');
t = t.replace(/\.icon-teal\s*\{[^}]*\}/, '.icon-teal { background: linear-gradient(135deg, #5FBFBF, #8FD4D4); }');
t = t.replace(/\.icon-pink\s*\{[^}]*\}/, '.icon-pink { background: linear-gradient(135deg, #E08BB4, #F2B0CE); }');

fs.writeFileSync(p, t);
console.log('替换', n, '处旧蓝系色值；图标渐变已柔和化');
