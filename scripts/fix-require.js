// 一次性脚本：修正组件 require 路径（components/scan-panel 与 pages/scan 同为两级目录，无需三级回溯）
const fs = require('fs');

['components/scan-panel/scan-panel.js', 'components/decode-panel/decode-panel.js'].forEach(p => {
  let t = fs.readFileSync(p, 'utf8');
  const before = (t.match(/require\('\.\.\/\.\.\/\.\.\//g) || []).length;
  t = t.replace(/require\('\.\.\/\.\.\/\.\.\//g, "require('../../");
  fs.writeFileSync(p, t);
  console.log(p, '修正', before, '处 require 路径');
  // 语法校验
  try {
    require('module')._resolveFilename;
    new (require('vm').Script)(t, { filename: p });
    console.log('  语法 OK');
  } catch (e) {
    console.log('  语法错误:', e.message);
  }
});
