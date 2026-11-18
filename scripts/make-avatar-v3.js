// v3：手写 SVG 矢量头像 → 导出 1024/400/144 PNG
const { chromium } = require('E:/WeChatProjects/xuexi/admin-web/node_modules/playwright-core')
const fs = require('fs')
const path = require('path')

const OUT_DIR = 'E:/WeChatProjects/xuexi/design/avatar/v3'
fs.mkdirSync(OUT_DIR, { recursive: true })

// ===== 矢量图标定义（1024×1024 画布） =====
// 宫格：2×2 等分，块 352×352，间距 56，四周留白 132，块圆角 72
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="#F9F4EB"/>

  <!-- 左上：砖红 · 扫码识别（核心能力） -->
  <g transform="translate(132,132)">
    <rect width="352" height="352" rx="72" fill="#C0553D"/>
    <g stroke="#FFFFFF" stroke-width="32" stroke-linecap="round" fill="none">
      <path d="M 140 72 H 98 Q 72 72 72 98 V 140"/>
      <path d="M 212 72 H 254 Q 280 72 280 98 V 140"/>
      <path d="M 72 212 V 254 Q 72 280 98 280 H 140"/>
      <path d="M 280 212 V 254 Q 280 280 254 280 H 212"/>
    </g>
    <rect x="146" y="146" width="60" height="60" rx="14" fill="#FFFFFF"/>
  </g>

  <!-- 右上：深棕 · 拍照识别（镜头环） -->
  <g transform="translate(540,132)">
    <rect width="352" height="352" rx="72" fill="#2B1D18"/>
    <circle cx="176" cy="176" r="54" fill="none" stroke="#F2B04E" stroke-width="30"/>
    <circle cx="176" cy="176" r="12" fill="#F2B04E"/>
  </g>

  <!-- 左下：琥珀 · 历史/记录（时钟） -->
  <g transform="translate(132,540)">
    <rect width="352" height="352" rx="72" fill="#F2B04E"/>
    <circle cx="176" cy="176" r="64" fill="none" stroke="#FFFFFF" stroke-width="28"/>
    <g stroke="#FFFFFF" stroke-width="26" stroke-linecap="round">
      <path d="M 176 176 L 138 138"/>
      <path d="M 176 176 L 214 144"/>
    </g>
  </g>

  <!-- 右下：白 · 更多工具（三点） -->
  <g transform="translate(540,540)">
    <rect width="352" height="352" rx="72" fill="#FFFFFF"/>
    <g fill="#C0553D">
      <circle cx="108" cy="176" r="26"/>
      <circle cx="176" cy="176" r="26"/>
      <circle cx="244" cy="176" r="26"/>
    </g>
  </g>
</svg>
`

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } })

  const svgUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
  const sizes = await page.evaluate(async (src) => {
    const img = new Image()
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src })
    const out = {}
    for (const size of [1024, 400, 144]) {
      const c = document.createElement('canvas')
      c.width = size; c.height = size
      const ctx = c.getContext('2d')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, size, size)
      out[size] = c.toDataURL('image/png').split(',')[1]
    }
    return out
  }, svgUrl)

  for (const [size, b64] of Object.entries(sizes)) {
    const p = path.join(OUT_DIR, `avatar-${size}.png`)
    fs.writeFileSync(p, Buffer.from(b64, 'base64'))
    console.log('已导出:', p, fs.statSync(p).size + 'B')
  }
  await browser.close()
}

main().catch(e => { console.error(e.message); process.exit(1) })
