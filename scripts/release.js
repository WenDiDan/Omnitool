/**
 * 一键发布后台
 *
 * 用法：
 *   node scripts/release.js          # 默认：本地构建 + 静态托管上传（快，约 30 秒）
 *   node scripts/release.js --app    # 应用部署：云端构建 + 版本管理（慢 3~5 分钟，可回滚）
 *
 * 两条路径都会同步部署 adminApi 云函数并确认索引，区别只在后台前端怎么上线：
 *   - 静态托管（hosting deploy）：本地出 dist 后直接上传文件，控制台只有文件列表
 *   - 应用部署（app deploy）：上传源码，云端装依赖并构建，控制台有应用卡片/版本/构建日志
 */
const { spawnSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '..')
const ENV = 'wendi-d5gnswjf75b25aac0'
const TCB_CLI = 'C:/Program Files/nodejs/node_global/node_modules/@cloudbase/cli/bin/tcb'
const APP_NAME = 'xuexi-admin'

// --app 走云端构建的应用部署；默认走静态托管
const USE_APP = process.argv.includes('--app')

function step(title) {
  console.log('\n════ ' + title + ' ════')
}

function sh(cmd, cwd) {
  // tcb 的部分日志走 stderr（PowerShell 包装），必须合并判断
  const r = spawnSync(cmd, { cwd: cwd || ROOT, shell: true, encoding: 'utf8' })
  const out = ((r.stdout || '') + (r.stderr || '')).replace(/\x1b\[[0-9;]*m/g, '')
  if (r.status !== 0) {
    const err = new Error('命令失败：' + cmd)
    err.detail = out
    throw err
  }
  return out
}

/** 直接调 CLI 入口（不经 shell，避免引号转义问题） */
function cli(args, opts = {}) {
  const r = spawnSync(process.execPath, [TCB_CLI, ...args], {
    encoding: 'utf8',
    cwd: opts.cwd || ROOT,
    timeout: opts.timeout || 120000,
    input: opts.input
  })
  const out = ((r.stdout || '') + (r.stderr || '')).replace(/\x1b\[[0-9;]*m/g, '')
  return { status: r.status, out }
}

function fail(msg) {
  console.error('\n✖ ' + msg)
  process.exit(1)
}

// ── 1. 后台前端上线 ──
if (USE_APP) {
  step('应用部署 admin-web（云端构建）')
  console.log('上传源码 → 云端安装依赖并构建，通常需要 3~5 分钟…')
  try {
    // 必须带 --json：不加时 CLI 会在无终端环境下就「安装/构建命令」发起交互提问并卡死；
    // 也不要喂 stdin 回车 —— 回车会把已传入的 build command 覆盖为空，导致云端构建失败
    cli([
      'app', 'deploy', APP_NAME,
      '-e', ENV,
      '--framework', 'vite',
      '--install-command', 'npm install',
      '--build-command', 'npm run build',
      '--output-dir', 'dist',
      '--deploy-path', '/',
      '-f',
      '--json'
    ], { cwd: path.join(ROOT, 'admin-web'), timeout: 900000 })
  } catch (e) {
    fail('应用部署调用失败\n' + (e.detail || e.message))
  }

  // CLI 异步构建，回头查一次状态给出结论
  step('应用构建状态')
  const { out } = cli(['app', 'list', '-e', ENV, '--json'], { timeout: 90000 })
  const m = out.match(/\{[\s\S]*\}/)
  let app = null
  if (m) {
    try {
      const j = JSON.parse(m[0])
      app = (j.data || []).find((d) => d.serviceName === APP_NAME)
    } catch (e) { /* 解析失败走兜底提示 */ }
  }
  if (app) {
    console.log(`✔ ${app.serviceName} | 版本 ${app.latestVersionName} | 状态 ${app.latestStatus}`)
    console.log(`  访问地址：${app.url}`)
    if (app.latestStatus === 'BUILDING') {
      console.log('  云端仍在构建，完成后刷新控制台「静态网站托管 → 应用部署」查看')
    } else if (app.latestStatus !== 'SUCCESS') {
      fail('构建未成功，请到控制台查看构建日志')
    }
  } else {
    console.log('✔ 部署指令已提交，请稍后到控制台「应用部署」查看')
  }
} else {
  step('构建 admin-web（本地）')
  try {
    const out = sh('npm run build', path.join(ROOT, 'admin-web'))
    const m = out.match(/dist\/assets\/index-[\w-]+\.js/)
    console.log('✔ 构建完成' + (m ? '：' + m[0] : ''))
  } catch (e) {
    fail('构建失败\n' + (e.detail || e.message))
  }

  if (!fs.existsSync(path.join(ROOT, 'admin-web', 'dist', 'index.html'))) fail('dist/index.html 不存在')

  step('部署静态托管')
  try {
    const out = sh(`tcb hosting deploy dist / -e ${ENV}`, path.join(ROOT, 'admin-web'))
    const m = out.match(/Deployment complete => (\S+)/)
    if (!m) fail('静态站部署未返回地址')
    console.log('✔ ' + m[1])
  } catch (e) {
    fail('静态站部署失败\n' + (e.detail || e.message))
  }
}

// ── 2. 部署云函数 adminApi（两条路径共用）──
step('部署云函数 adminApi')
try {
  const out = sh(`tcb fn deploy adminApi --force -e ${ENV}`)
  if (!/deployed successfully|部署成功/.test(out)) fail('云函数部署未返回成功标志')
  console.log('✔ adminApi 已部署')
} catch (e) {
  fail('云函数部署失败\n' + (e.detail || e.message))
}

// ── 3. 幂等确保索引存在（重复执行安全）──
step('确认 tool_records 复合索引')
const cmds = JSON.stringify([
  {
    TableName: 'tool_records',
    CommandType: 'COMMAND',
    Command: JSON.stringify({
      createIndexes: 'tool_records',
      indexes: [{ key: { owner_openid: 1, date: -1 }, name: 'idx_owner_openid_date', background: true }]
    })
  },
  {
    TableName: 'tool_records',
    CommandType: 'COMMAND',
    Command: JSON.stringify({ listIndexes: 'tool_records' })
  }
])

const idx = cli(['db', 'nosql', 'execute', '-e', ENV, '--command', cmds, '--json'])

if (!/idx_owner_openid_date/.test(idx.out)) {
  console.warn('⚠ 未能自动确认索引，请到控制台核对 tool_records 索引')
  console.warn(idx.out.slice(-600))
  process.exit(2)
}
if (/all indexes already exist/.test(idx.out)) console.log('✔ 索引已存在（未重复创建）')
else console.log('✔ 索引已创建')
console.log('  idx_owner_openid_date = { owner_openid: 1, date: -1 }')

console.log('\n════ 发布完成 ════')
console.log(USE_APP
  ? '后台走应用部署（云端构建，可在控制台按版本回滚）+ adminApi 已更新'
  : '后台走静态托管上传 + adminApi 已更新，索引已就位')
