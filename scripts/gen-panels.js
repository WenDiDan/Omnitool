// 一次性脚本：将 pages/scan、pages/decode 转换为自定义组件
const fs = require('fs');

const jobs = [
  ['pages/scan', 'components/scan-panel', 'scan-panel', 'scan'],
  ['pages/decode', 'components/decode-panel', 'decode-panel', 'decode']
];

jobs.forEach(([src, dst, name, old]) => {
  fs.mkdirSync(dst, { recursive: true });

  // wxml / wxss 直接复制
  fs.writeFileSync(dst + '/' + name + '.wxml', fs.readFileSync(src + '/' + old + '.wxml', 'utf8'));
  fs.writeFileSync(dst + '/' + name + '.wxss', fs.readFileSync(src + '/' + old + '.wxss', 'utf8'));
  fs.writeFileSync(dst + '/' + name + '.json', JSON.stringify({ component: true, usingComponents: {} }, null, 2));

  // js 转 Component
  let t = fs.readFileSync(src + '/' + old + '.js', 'utf8');
  // 相对路径修正：组件目录多一层
  t = t.replace(/require\('\.\.\/\.\.\//g, "require('../../../");
  // Page({ → Component({ + 生命周期桥接
  t = t.replace(/Page\(\{/, [
    'Component({',
    '  options: { addGlobalClass: true },',
    '  lifetimes: {',
    '    attached() { this.onLoad && this.onLoad({}); },',
    '    detached() { this.onUnload && this.onUnload(); }',
    '  },',
    '  pageLifetimes: {',
    '    show() { this.onShow && this.onShow(); },',
    '    hide() { this.onHide && this.onHide(); }',
    '  },'
  ].join('\n'));
  // data 块之后的所有方法收进 methods: {
  if (t.indexOf('methods: {') === -1) {
    t = t.replace(/\n  onLoad\(options\) \{/, '\n  methods: {\n  onLoad(options) {');
    // 末尾闭合 methods
    t = t.replace(/\}\s*\)\s*$/, '  }\n})\n');
  }
  fs.writeFileSync(dst + '/' + name + '.js', t);
  console.log('生成', name, '| Component:', /Component\(\{/.test(t), '| methods:', /methods: \{/.test(t), '| 路径修正:', !/require\('\.\.\/\.\.\//.test(t));
});
