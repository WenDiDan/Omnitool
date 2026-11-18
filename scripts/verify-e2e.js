// 端到端验证：页面可达 + CORS 预检 + API 跨域头
const https = require('https')

function req(opts, data) {
  return new Promise(resolve => {
    const q = https.request(opts, res => {
      let b = ''
      res.on('data', c => b += c)
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }))
    })
    q.on('error', e => resolve({ status: 'ERR', body: e.message }))
    if (data) q.write(data)
    q.end()
  })
}

;(async () => {
  // 1. 静态托管页面
  const host = 'wendi-d5gnswjf75b25aac0-1526094764.tcloudbaseapp.com'
  const page = await req({ hostname: host, path: '/', method: 'GET' })
  console.log('[页面]', page.status, page.body.includes('<div id="app">') ? 'index.html 正常' : page.body.slice(0, 150))

  // 1.1 首页引用的构建产物是否都已上线
  const assetRefs = [...new Set((page.body.match(/assets\/index-[\w-]+\.(?:js|css)/g) || []))]
  for (const ref of assetRefs) {
    const r = await req({ hostname: host, path: '/' + ref, method: 'GET' })
    console.log('[资源]', ref, r.status)
  }

  // 2. CORS 预检
  const pre = await req({
    hostname: 'wendi-d5gnswjf75b25aac0.service.tcloudbase.com',
    path: '/adminApi', method: 'OPTIONS',
    headers: { 'Origin': 'https://wendi-d5gnswjf75b25aac0-1526094764.tcloudbaseapp.com', 'Access-Control-Request-Method': 'POST' }
  })
  console.log('[CORS 预检]', pre.status, '| Allow-Origin:', pre.headers['access-control-allow-origin'] || '缺失')

  // 3. 正常 POST 跨域
  const data = JSON.stringify({ action: 'admin.init', initCode: 'x', username: 'a', password: 'b' })
  const post = await req({
    hostname: 'wendi-d5gnswjf75b25aac0.service.tcloudbase.com',
    path: '/adminApi', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'Origin': 'https://wendi-d5gnswjf75b25aac0-1526094764.tcloudbaseapp.com' }
  }, data)
  console.log('[API 跨域 POST]', post.status, '| Allow-Origin:', post.headers['access-control-allow-origin'] || '缺失', '→', post.body)
})()
