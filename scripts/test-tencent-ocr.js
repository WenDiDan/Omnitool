/**
 * 腾讯云 OCR（GeneralBasicOCR 通用印刷体识别）连通性测试
 *
 * 通过 `tcb secrets get` 取当前登录会话的临时密钥（无需手动配置），
 * 对本地图片做 TC3-HMAC-SHA256 签名调用，验证 OCR 服务是否开通且有免费额度。
 *
 * 用法：node scripts/test-tencent-ocr.js <本地图片路径>
 */
const { spawnSync } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const https = require('https')

const ENV_ID = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cloudbaserc.json'), 'utf8')).envId

function getTempCredentials() {
  const cliCandidates = [
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@cloudbase', 'cli', 'bin', 'tcb'),
    'C:\\Program Files\\nodejs\\node_global\\node_modules\\@cloudbase\\cli\\bin\\tcb',
    '/usr/local/lib/node_modules/@cloudbase/cli/bin/tcb'
  ]
  const cli = cliCandidates.find(p => fs.existsSync(p))
  if (!cli) throw new Error('未找到 CloudBase CLI')
  const res = spawnSync(process.execPath, [cli, 'secrets', 'get', '-e', ENV_ID, '--json'], { encoding: 'utf8' })
  const out = `${res.stdout || ''}`
  const m = out.match(/\{[\s\S]*"secretId"[\s\S]*\}/)
  if (!m) throw new Error('获取临时密钥失败：' + out.replace(/\s+/g, ' ').slice(0, 300))
  const d = JSON.parse(m[0]).data
  return { secretId: d.secretId, secretKey: d.secretKey, token: d.token }
}

/** 腾讯云 API 3.0 签名（TC3-HMAC-SHA256）并调用 GeneralBasicOCR */
function callOcr(cred, base64) {
  const host = 'ocr.tencentcloudapi.com'
  const service = 'ocr'
  const version = '2018-11-19'
  const action = 'GeneralBasicOCR'
  const region = 'ap-guangzhou'
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)

  const payload = JSON.stringify({ ImageBase64: base64 })
  const canonicalRequest = [
    'POST', '/', '', `content-type:application/json; charset=utf-8\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`,
    'content-type;host;x-tc-action',
    crypto.createHash('sha256').update(payload).digest('hex')
  ].join('\n')

  const stringToSign = [
    'TC3-HMAC-SHA256', timestamp,
    `${date}/${service}/tc3_request`,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex')
  ].join('\n')

  const kDate = crypto.createHmac('sha256', `TC3${cred.secretKey}`).update(date).digest()
  const kService = crypto.createHmac('sha256', kDate).update(service).digest()
  const kSigning = crypto.createHmac('sha256', kService).update('tc3_request').digest()
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex')

  const auth = `TC3-HMAC-SHA256 Credential=${cred.secretId}/${date}/${service}/tc3_request, SignedHeaders=content-type;host;x-tc-action, Signature=${signature}`

  const headers = {
    Host: host, 'X-TC-Action': action, 'X-TC-Version': version, 'X-TC-Region': region,
    'X-TC-Timestamp': String(timestamp), 'X-TC-Token': cred.token, Authorization: auth,
    'Content-Type': 'application/json; charset=utf-8'
  }

  return new Promise((resolve, reject) => {
    const req = https.request({ host, path: '/', method: 'POST', headers }, (res) => {
      let raw = ''
      res.on('data', c => (raw += c))
      res.on('end', () => {
        try { resolve(JSON.parse(raw)) } catch (e) { reject(new Error(raw.slice(0, 500))) }
      })
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

async function main() {
  const imgPath = process.argv[2]
  if (!imgPath || !fs.existsSync(imgPath)) return console.error('[ocr-test] 请传入本地图片路径')
  const base64 = fs.readFileSync(imgPath).toString('base64')
  if (base64.length > 7 * 1024 * 1024) return console.error('[ocr-test] 图片过大（base64 后超 7M）')

  const cred = getTempCredentials()
  console.log('[ocr-test] 已获取临时密钥，调用 GeneralBasicOCR …')
  const res = await callOcr(cred, base64)
  const resp = res.Response || {}
  if (resp.Error) {
    console.error(`[ocr-test] OCR 调用失败：${resp.Error.Code} ${resp.Error.Message}`)
    return
  }
  const texts = (resp.TextDetections || []).map(t => t.DetectedText)
  console.log('[ocr-test] 识别成功，文本片段：')
  console.log(texts.join(' | ').slice(0, 500))
}

main().catch(e => console.error('[ocr-test] 出错：', e.message))
