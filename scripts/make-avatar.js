// 裁掉生成图底部水印，导出小程序头像多尺寸版本
const { chromium } = require('E:/WeChatProjects/omnitool/admin-web/node_modules/playwright-core')
const fs = require('fs')
const path = require('path')

const SRC = 'E:/WeChatProjects/omnitool/design/avatar/v2/扁平化极简_App_图标_正方形_米白色__F9F4EB_背_2026-11-12T02-53-28.png'
const OUT_DIR = 'E:/WeChatProjects/omnitool/design/avatar/v2'

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } })

  const dataUrl = 'data:image/png;base64,' + fs.readFileSync(SRC).toString('base64')
  const sizes = await page.evaluate(async (src) => {
    const img = new Image()
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src })
    const results = {}
    const make = (size) => {
      // 裁剪：取左上 (0,0) 起的 size×size 区域（切掉底部水印），再缩放到目标尺寸
      const c = document.createElement('canvas')
      c.width = size; c.height = size
      const ctx = c.getContext('2d')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, img.width, img.height * 0.955, 0, 0, size, size)
      return c.toDataURL('image/png').split(',')[1]
    }
    for (const s of [1024, 400, 144]) results[s] = make(s)
    return results
  }, dataUrl)

  for (const [size, b64] of Object.entries(sizes)) {
    const p = path.join(OUT_DIR, `avatar-${size}.png`)
    fs.writeFileSync(p, Buffer.from(b64, 'base64'))
    console.log('已导出:', p, fs.statSync(p).size + 'B')
  }
  await browser.close()
}

main().catch(e => { console.error(e.message); process.exit(1) })
