// 全量校验：js 语法 + 页面/组件四件套 + 页面注册一致性 + 跳转可达
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const SKIP = ['node_modules', 'miniprogram_npm', '.git', 'dist', '.codebuddy', 'tests', 'admin-web']
const problems = []

// ---------- 1. 全部 js 语法检查 ----------
const jsFiles = []
;(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    if (SKIP.includes(f)) continue
    const p = path.join(d, f)
    const s = fs.statSync(p)
    if (s.isDirectory()) walk(p)
    else if (f.endsWith('.js') && f !== 'package-lock.json') jsFiles.push(p.replace(/\\/g, '/'))
  }
})('.')

let syntaxBad = 0
for (const f of jsFiles) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' })
  if (r.status !== 0) {
    syntaxBad++
    problems.push('语法错误: ' + f + ' → ' + (r.stderr || '').split('\n')[0])
  }
}
console.log(`① 语法检查: ${jsFiles.length} 个 js 文件，失败 ${syntaxBad}`)

// ---------- 2. app.json 页面注册与磁盘一致性 ----------
const app = JSON.parse(fs.readFileSync('app.json', 'utf8'))
const registered = new Set(app.pages)
let pageBad = 0
for (const p of app.pages) {
  for (const ext of ['.js', '.json', '.wxml']) {
    if (!fs.existsSync(p + ext)) { pageBad++; problems.push('页面缺文件: ' + p + ext) }
  }
}
// 磁盘上有但没注册的页面
const diskPages = []
;(function walkPages(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f)
    // 组件目录（如 pages/scan/components）不参与页面注册校验
    if (fs.statSync(p).isDirectory()) {
      if (f !== 'components') walkPages(p)
    } else if (f.endsWith('.js') && fs.existsSync(p.replace(/\.js$/, '.wxml'))) {
      const rel = p.replace(/\\/g, '/').replace(/\.js$/, '')
      if (rel.startsWith('pages/')) diskPages.push(rel)
    }
  }
})('pages')
const unregistered = diskPages.filter((p) => !registered.has(p))
if (unregistered.length) problems.push('未注册页面: ' + unregistered.join(', '))
console.log(`② 页面: 注册 ${app.pages.length}，磁盘 ${diskPages.length}，缺文件 ${pageBad}，未注册 ${unregistered.length}`)

// ---------- 3. 跳转路径可达 ----------
const jumps = []
;(function walk2(d) {
  for (const f of fs.readdirSync(d)) {
    if (SKIP.includes(f)) continue
    const p = path.join(d, f)
    const s = fs.statSync(p)
    if (s.isDirectory()) walk2(p)
    else if (/\.(js|wxml)$/.test(f)) {
      const t = fs.readFileSync(p, 'utf8')
      for (const m of t.matchAll(/['"`]\/(pages\/[\w\-/]+)/g)) {
        jumps.push({ file: p.replace(/\\/g, '/'), target: m[1] })
      }
    }
  }
})('.')
const uniq = [...new Map(jumps.map((j) => [j.target, j])).values()]
let jumpBad = 0
for (const j of uniq) {
  if (!registered.has(j.target)) {
    jumpBad++
    problems.push('跳转目标未注册: ' + j.target + ' ← ' + j.file)
  }
}
console.log(`③ 跳转: ${uniq.length} 个目标，未注册 ${jumpBad}`)

// ---------- 4. 组件四件套（不限定目录，按“非页面 + 同名四件套”识别） ----------
const pageSet4 = new Set(app.pages)
const compBases = []
;(function walkComp(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f).replace(/\\/g, '/')
    const s = fs.statSync(p)
    if (s.isDirectory()) {
      const base = p + '/' + f
      const isPage = pageSet4.has(base)
      if (!isPage && fs.existsSync(base + '.wxml') && fs.existsSync(base + '.json') && fs.existsSync(base + '.js')) {
        compBases.push(base)
      }
      walkComp(p)
    }
  }
})('pages')
let compBad = 0
for (const base of compBases) {
  if (!fs.existsSync(base + '.js') || !fs.existsSync(base + '.json') || !fs.existsSync(base + '.wxml')) {
    compBad++
    problems.push('组件缺文件: ' + base)
  }
}
console.log(`④ 组件: ${compBases.length} 个，缺文件 ${compBad}`)

// ---------- 5. package1 等已删除目录残留 ----------
for (const dir of ['package1', 'package2', 'pages/browser', 'cloudfunctions/fetchWeb']) {
  if (fs.existsSync(dir)) problems.push('应删除但存在: ' + dir)
}
console.log('⑤ 废弃目录残留:', ['package1', 'pages/browser', 'cloudfunctions/fetchWeb'].filter((d) => fs.existsSync(d)).length)

// ---------- 6. 全部 json 语法 + usingComponents 路径可解析 ----------
const jsonFiles = []
;(function walkJson(d) {
  for (const f of fs.readdirSync(d)) {
    if (SKIP.includes(f)) continue
    const p = path.join(d, f)
    const s = fs.statSync(p)
    if (s.isDirectory()) walkJson(p)
    else if (f.endsWith('.json') && f !== 'package-lock.json') jsonFiles.push(p.replace(/\\/g, '/'))
  }
})('.')

let jsonBad = 0
let compRefBad = 0
for (const f of jsonFiles) {
  let cfg
  try {
    cfg = JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch (e) {
    jsonBad++
    problems.push('JSON 解析失败: ' + f + ' → ' + e.message)
    continue
  }
  const using = cfg.usingComponents || {}
  for (const [name, ref] of Object.entries(using)) {
    // 插件组件（plugin://）与扩展库不参与本地解析
    if (ref.startsWith('plugin://')) continue
    const base = ref.startsWith('/')
      ? '.' + ref
      : ref.startsWith('.')
        ? path.join(path.dirname(f), ref)
        : path.join('miniprogram_npm', ref)
    if (!fs.existsSync(base + '.js') || !fs.existsSync(base + '.wxml')) {
      compRefBad++
      problems.push('组件引用缺失: ' + name + ' → ' + ref + '（' + f + '）')
    }
  }
}
console.log(`⑥ JSON 与组件引用: ${jsonFiles.length} 个 json，解析失败 ${jsonBad}，组件缺失 ${compRefBad}`)

// ---------- 7. 本地 js 相对引用可解析 ----------
let requireBad = 0
for (const f of jsFiles) {
  const t = fs.readFileSync(f, 'utf8')
  const specs = []
  for (const m of t.matchAll(/(?:require\(\s*|from\s*)['"](\.[^'"]+)['"]/g)) specs.push(m[1])
  for (const r of specs) {
    const target = path.resolve(path.dirname(f), r)
    if (
      !fs.existsSync(target) &&
      !fs.existsSync(target + '.js') &&
      !fs.existsSync(target + '.json') &&
      !fs.existsSync(path.join(target, 'index.js'))
    ) {
      requireBad++
      problems.push('js 引用缺失: ' + f + ' → ' + r)
    }
  }
}
console.log(`⑦ js 本地引用: 缺失 ${requireBad}`)

// ---------- 8. tabBar 图标与图片引用可解析 ----------
const imgRefs = new Set()
const imgBad = []
;(app.tabBar && app.tabBar.list ? app.tabBar.list : []).forEach((t) => {
  for (const key of ['iconPath', 'selectedIconPath']) {
    if (t[key]) imgRefs.add({ file: 'app.json', ref: t[key] })
  }
})
const assetFiles = []
;(function walkAsset(d) {
  for (const f of fs.readdirSync(d)) {
    if (SKIP.includes(f)) continue
    const p = path.join(d, f)
    const s = fs.statSync(p)
    if (s.isDirectory()) walkAsset(p)
    else if (/\.(js|wxml|wxss)$/.test(f)) assetFiles.push(p.replace(/\\/g, '/'))
  }
})('.')
for (const f of assetFiles) {
  const t = fs.readFileSync(f, 'utf8')
  for (const m of t.matchAll(/['"(=\s]((?:\/|\.\.\/)*images\/[\w\-.]+\.(?:png|jpe?g|svg|gif|webp|wav|mp3))/g)) {
    imgRefs.add({ file: f, ref: m[1] })
  }
}
let imgMiss = 0
for (const { file, ref } of imgRefs) {
  const target = ref.startsWith('/') ? '.' + ref : path.resolve(path.dirname(file), ref)
  if (!fs.existsSync(target)) {
    imgMiss++
    problems.push('图片缺失: ' + ref + ' ← ' + file)
  }
}
console.log(`⑧ 图片资源: ${imgRefs.size} 个引用，缺失 ${imgMiss}`)

// ---------- 9. cloudfunctions 目录与 cloudbaserc 配置一致 ----------
const rc = JSON.parse(fs.readFileSync('cloudbaserc.json', 'utf8'))
const configuredFn = new Set((rc.functions || []).map((x) => x.name))
const diskFn = fs
  .readdirSync('cloudfunctions', { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join('cloudfunctions', e.name, 'index.js')))
  .map((e) => e.name)
const unconfigured = diskFn.filter((n) => !configuredFn.has(n))
const missingDir = [...configuredFn].filter((n) => !diskFn.includes(n))
if (unconfigured.length) problems.push('云函数未纳入 cloudbaserc: ' + unconfigured.join(', '))
if (missingDir.length) problems.push('cloudbaserc 配置无对应目录: ' + missingDir.join(', '))
console.log(`⑨ 云函数配置: 磁盘 ${diskFn.length}，配置 ${configuredFn.size}，未配置 ${unconfigured.length}，无目录 ${missingDir.length}`)

// ---------- 10. 云函数公共代码副本与来源一致 ----------
let sharedBad = 0
const sharedDir = 'cloudfunctions/_shared'
if (fs.existsSync(sharedDir)) {
  const sharedFiles = fs.readdirSync(sharedDir).filter((f) => f.endsWith('.js'))
  const sharedFns = diskFn.filter((fn) => {
    const entry = fs.readFileSync(path.join('cloudfunctions', fn, 'index.js'), 'utf8')
    return entry.includes("'./_shared/") || entry.includes('"./_shared/')
  })
  for (const fn of sharedFns) {
    for (const f of sharedFiles) {
      const src = path.join(sharedDir, f)
      const dest = path.join('cloudfunctions', fn, '_shared', f)
      if (!fs.existsSync(dest) || fs.readFileSync(dest, 'utf8') !== fs.readFileSync(src, 'utf8')) {
        sharedBad++
        problems.push('云函数公共代码未同步: cloudfunctions/' + fn + '/_shared/' + f)
      }
    }
  }
}
console.log(`⑩ 云函数公共代码: 未同步 ${sharedBad}`)

console.log('\n' + (problems.length ? '✖ 问题 ' + problems.length + ' 项:\n' + problems.join('\n') : '✔ 全部通过'))
process.exitCode = problems.length ? 1 : 0
