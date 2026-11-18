/** 重建 miniprogram_npm：完整复制 tdesign-miniprogram 产物 + tslib（幂等） */
const fs = require('fs')
const path = require('path')
const root = process.cwd()

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true })
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, e.name)
    const to = path.join(dst, e.name)
    if (e.isDirectory()) copyDir(from, to)
    else fs.copyFileSync(from, to)
  }
}

// 1) tdesign-miniprogram 完整产物
const tsrc = path.join(root, 'node_modules/tdesign-miniprogram/miniprogram_dist')
const tdst = path.join(root, 'miniprogram_npm/tdesign-miniprogram')
if (!fs.existsSync(tsrc)) { console.error('未找到 tdesign 源包'); process.exit(1) }
copyDir(tsrc, tdst)
console.log('tdesign-miniprogram 已重建，组件目录数:', fs.readdirSync(tdst).filter(f => fs.statSync(path.join(tdst, f)).isDirectory()).length)

// 2) tslib（组件 ES6 import "tslib" 的运行时依赖）
let tslibSrc = null
for (const cand of ['node_modules/tslib', 'node_modules/.tslib-ZnLvfTPt']) {
  if (fs.existsSync(path.join(root, cand, 'modules/index.js'))) { tslibSrc = path.join(root, cand); break }
}
if (tslibSrc) {
  const tdstLib = path.join(root, 'miniprogram_npm/tslib')
  fs.mkdirSync(tdstLib, { recursive: true })
  fs.copyFileSync(path.join(tslibSrc, 'modules/index.js'), path.join(tdstLib, 'index.js'))
  const pkg = JSON.parse(fs.readFileSync(path.join(tslibSrc, 'package.json'), 'utf8'))
  fs.writeFileSync(path.join(tdstLib, 'package.json'), JSON.stringify({ name: 'tslib', version: pkg.version, main: 'index.js' }, null, 2))
  console.log('tslib 已重建')
} else {
  console.warn('未找到 tslib，跳过（若组件报 module not defined 需手动补）')
}

console.log('完成，请重新编译小程序')
