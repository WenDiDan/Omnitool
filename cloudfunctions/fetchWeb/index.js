const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const http = require('http')
const https = require('https')

exports.main = async (event) => {
  const { url, type } = event
  if (!url) return { code: 400, msg: '缺少url参数' }

  try {
    const html = await fetchUrl(url)
    const title = extractTitle(html)
    let items = []

    if (type === 'search') {
      items = parseSearchResults(html)
    }

    // 提取纯文本段落
    const paragraphs = extractParagraphs(html)

    // 提取图片
    const images = extractImages(html, url)

    return { code: 0, title, paragraphs, images, items, url }
  } catch (err) {
    return { code: 500, msg: '获取网页失败: ' + (err.message || '未知错误') }
  }
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/107.0.0.0 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'identity'
      },
      timeout: 10000
    }
    const req = proto.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let loc = res.headers.location
        if (!loc.startsWith('http')) {
          const base = new URL(url)
          loc = base.origin + loc
        }
        return fetchUrl(loc).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error('HTTP ' + res.statusCode))
      }
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        const buf = Buffer.concat(chunks)
        let html = buf.toString('utf-8')
        const charsetMatch = html.match(/charset=["']?([^"'\s;>]+)/i)
        if (charsetMatch) {
          const cs = charsetMatch[1].toLowerCase().replace(/[^a-z0-9\-]/g, '')
          if (cs && cs !== 'utf8' && cs !== 'utf-8') {
            try {
              const iconv = require('iconv-lite')
              if (iconv.encodingExists(cs)) {
                html = iconv.decode(buf, cs)
              }
            } catch (e) {}
          }
        }
        resolve(html)
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')) })
  })
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return m ? m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim() : ''
}

function extractParagraphs(html) {
  let body = html

  // 移除无关内容
  body = body.replace(/<script[\s\S]*?<\/script>/gi, '')
  body = body.replace(/<style[\s\S]*?<\/style>/gi, '')
  body = body.replace(/<nav[\s\S]*?<\/nav>/gi, '')
  body = body.replace(/<footer[\s\S]*?<\/footer>/gi, '')
  body = body.replace(/<header[\s\S]*?<\/header>/gi, '')
  body = body.replace(/<aside[\s\S]*?<\/aside>/gi, '')
  body = body.replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
  body = body.replace(/<!--[\s\S]*?-->/g, '')
  body = body.replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
  body = body.replace(/<svg[\s\S]*?<\/svg>/gi, '')
  body = body.replace(/<form[\s\S]*?<\/form>/gi, '')

  // 提取body
  const bodyMatch = body.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  body = bodyMatch ? bodyMatch[1] : body

  // 提取 <p>, <h1>-<h6>, <li>, <blockquote>, <pre>, <td> 中的文本
  const results = []
  const tagRegex = /<(h[1-6]|p|li|blockquote|pre|td|th|dt|dd|figcaption|caption|summary)[^>]*>([\s\S]*?)<\/\1>/gi
  let match

  while ((match = tagRegex.exec(body)) !== null) {
    const tag = match[1].toLowerCase()
    let text = match[2].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).trim()
    text = text.replace(/\s+/g, ' ')
    if (!text || text.length < 3) continue

    if (/^h[1-6]$/.test(tag)) {
      results.push({ type: 'heading', level: parseInt(tag[1]), text })
    } else if (tag === 'li') {
      results.push({ type: 'listitem', text })
    } else if (tag === 'blockquote') {
      results.push({ type: 'quote', text })
    } else if (tag === 'pre') {
      results.push({ type: 'code', text })
    } else {
      results.push({ type: 'paragraph', text })
    }
  }

  // 如果提取结果太少，尝试从整个body提取文本
  if (results.length < 3) {
    const allText = body.replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    const lines = allText.split('\n').map(l => l.trim()).filter(l => l.length > 5)
    return lines.slice(0, 50).map(text => ({ type: 'paragraph', text }))
  }

  return results.slice(0, 80)
}

function extractImages(html, baseUrl) {
  const images = []
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
  let match
  let baseHost = ''
  try { baseHost = new URL(baseUrl).origin } catch (e) {}

  while ((match = imgRegex.exec(html)) !== null && images.length < 5) {
    let src = match[1]
    if (src.startsWith('//')) src = 'https:' + src
    else if (src.startsWith('/')) src = baseHost + src
    else if (!src.startsWith('http')) src = baseHost + '/' + src

    // 过滤小图标、logo等
    if (/logo|icon|avatar|badge|spinner|loading|pixel|blank|spacer|arrow|btn/i.test(src)) continue
    if (src.endsWith('.svg') || src.endsWith('.gif')) continue

    const widthMatch = match[0].match(/width["'=]\s*(\d+)/i)
    const heightMatch = match[0].match(/height["'=]\s*(\d+)/i)
    const w = widthMatch ? parseInt(widthMatch[1]) : 0
    const h = heightMatch ? parseInt(heightMatch[1]) : 0
    if (w > 0 && w < 80) continue
    if (h > 0 && h < 80) continue

    const altMatch = match[0].match(/alt=["']([^"']*)["']/i)
    const alt = altMatch ? altMatch[1] : ''

    images.push({ src, alt })
  }
  return images
}

function parseSearchResults(html) {
  const items = []
  // 百度搜索结果
  const baiduRegex = /<h3[^>]*class="[^"]*(?:t|c-gap-bottom-small)[^"]*"[^>]*>([\s\S]*?)<\/h3>/gi
  let match
  while ((match = baiduRegex.exec(html)) !== null && items.length < 10) {
    const title = match[1].replace(/<[^>]+>/g, '').trim()
    if (!title) continue
    const afterIdx = match.index + match[0].length
    const afterText = html.substring(afterIdx, afterIdx + 800)
    const descMatch = afterText.match(/<span[^>]*class="[^"]*content-right[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
      || afterText.match(/<p[^>]*class="[^"]*(?:content|desc)[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
      || afterText.match(/<div[^>]*class="[^"]*c-abstract[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
    const desc = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim().substring(0, 150) : ''

    const beforeIdx = Math.max(0, match.index - 300)
    const beforeText = html.substring(beforeIdx, match.index + match[0].length)
    const linkMatch = beforeText.match(/href=["'](https?:\/\/[^"']+)["']/i)
    const link = linkMatch ? linkMatch[1] : ''

    items.push({ title, desc, link })
  }

  // 通用搜索结果兜底
  if (items.length === 0) {
    const h3Regex = /<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/gi
    while ((match = h3Regex.exec(html)) !== null && items.length < 10) {
      const title = match[1].replace(/<[^>]+>/g, '').trim()
      if (!title || title.length < 2) continue
      const afterIdx = match.index + match[0].length
      const afterText = html.substring(afterIdx, afterIdx + 500)
      const descMatch = afterText.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
      const desc = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim().substring(0, 150) : ''

      const around = html.substring(Math.max(0, match.index - 200), match.index + match[0].length)
      const linkMatch = around.match(/href=["'](https?:\/\/[^"']+)["']/i)
      const link = linkMatch ? linkMatch[1] : ''

      items.push({ title, desc, link })
    }
  }

  return items
}
