#!/usr/bin/env node
/**
 * 云函数公共代码同步
 *
 * 背景：腾讯云 CloudBase 按函数目录独立打包部署，函数无法 require 上级目录，
 * 因此公共代码以「单一来源 + 复制副本」的方式维护：
 *   来源：cloudfunctions/_shared/*.js
 *   副本：cloudfunctions/<fn>/_shared/*.js
 *
 * 用法：
 *   node scripts/sync-cloud-shared.js          同步副本
 *   node scripts/sync-cloud-shared.js --check  仅检查是否一致（供 CI / final-check 使用）
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SRC_DIR = path.join(ROOT, 'cloudfunctions', '_shared')
const CHECK = process.argv.includes('--check')

if (!fs.existsSync(SRC_DIR)) {
  console.error('✖ 缺少公共目录: cloudfunctions/_shared')
  process.exit(1)
}

const sharedFiles = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.js'))
const functions = fs
  .readdirSync(path.join(ROOT, 'cloudfunctions'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== '_shared')
  .filter((d) => fs.existsSync(path.join(ROOT, 'cloudfunctions', d.name, 'index.js')))
  .map((d) => d.name)
  // 只同步真正引用公共代码的函数，避免无关函数多打包两份副本
  .filter((name) => {
    const entry = fs.readFileSync(path.join(ROOT, 'cloudfunctions', name, 'index.js'), 'utf8')
    return entry.includes("'./_shared/") || entry.includes('"./_shared/')
  })

let outOfSync = 0
for (const fn of functions) {
  const destDir = path.join(ROOT, 'cloudfunctions', fn, '_shared')
  for (const file of sharedFiles) {
    const src = path.join(SRC_DIR, file)
    const dest = path.join(destDir, file)
    const srcText = fs.readFileSync(src, 'utf8')

    if (CHECK) {
      const same = fs.existsSync(dest) && fs.readFileSync(dest, 'utf8') === srcText
      if (!same) {
        outOfSync++
        console.error(`✖ 未同步: cloudfunctions/${fn}/_shared/${file}`)
      }
      continue
    }

    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
    fs.writeFileSync(dest, srcText)
  }
}

if (CHECK) {
  console.log(outOfSync ? `✖ 云函数公共代码有 ${outOfSync} 处未同步` : `✔ 云函数公共代码已同步（${functions.length} 个函数）`)
  process.exitCode = outOfSync ? 1 : 0
} else {
  console.log(`✔ 已同步公共代码到 ${functions.length} 个云函数: ${functions.join(', ')}`)
}
