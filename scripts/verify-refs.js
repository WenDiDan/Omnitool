// 全面扫描所有 wxml 的 <wxs src> / include / import 引用，验证全部可解析
const fs = require('fs')
const path = require('path')

const targets = ['miniprogram_npm', 'pages', 'components']

const refs = []
targets.forEach(root => {
  ;(function walk(d) {
    if (!fs.existsSync(d)) return
    fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
      const p = d + '/' + e.name
      if (e.isDirectory()) walk(p)
      else if (/\.wxml$/.test(e.name)) {
        const t = fs.readFileSync(p, 'utf8')
        ;(t.match(/<wxs\s[^>]*src=["']([^"']+)["']/g) || []).forEach(m => {
          refs.push({ from: p.replace(/\\/g, '/'), src: m.match(/src=["']([^"']+)["']/)[1], type: 'wxs' })
        })
        ;(t.match(/<(?:include|import)\s+src=["']([^"']+)["']/g) || []).forEach(m => {
          refs.push({ from: p.replace(/\\/g, '/'), src: m.match(/src=["']([^"']+)["']/)[1], type: 'include' })
        })
      }
    })
  })(root)
})

let broken = 0
refs.forEach(({ from, src, type }) => {
  const target = path.relative('.', path.resolve(path.dirname(from), src)).replace(/\\/g, '/')
  const ok = fs.existsSync(target)
  if (!ok) broken++
  console.log((ok ? '✓' : '★缺失'), type, from.slice(20), '→', src)
})
console.log(broken ? `★ ${broken} 处缺失` : '✓ 全部 wxml 模块引用可解析')

// 顺带验证：所有保留组件 js 的 require/from 目标（复跑精简版）
const NP = 'miniprogram_npm/tdesign-miniprogram'
const jsFiles = []
;(function walk(d) {
  fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    const p = d + '/' + e.name
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith('.js')) jsFiles.push(p.replace(/\\/g, '/'))
  })
})(NP)
let miss = 0
jsFiles.forEach(f => {
  const t = fs.readFileSync(f, 'utf8')
  const all = []
  ;(t.match(/from\s*["'](\.[^"']+)["']/g) || []).forEach(m => all.push(m.match(/["']([^"']+)["']/)[1]))
  ;(t.match(/require\(\s*["'](\.[^"']+)["']\s*\)/g) || []).forEach(m => all.push(m.match(/["']([^"']+)["']/)[1]))
  all.forEach(r => {
    const target = path.resolve(path.dirname(f), r)
    if (!fs.existsSync(target) && !fs.existsSync(target + '.js') && !fs.existsSync(path.join(target, 'index.js'))) {
      miss++
      console.log('★js 缺失:', f, '→', r)
    }
  })
})
console.log(miss ? `★ ${miss} 处 js 引用缺失` : '✓ 全部 js 引用可解析')
