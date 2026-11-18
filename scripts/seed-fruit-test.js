/**
 * 多多水果互助 · 广场测试数据脚本
 *
 * 直接通过 CloudBase CLI 操作 fruit_links 集合（需先 `npx tcb login` 登录）。
 * 写入的文档统一带 is_test: true，便于一次性清理，不影响真实用户数据。
 *
 * 用法：
 *   node scripts/seed-fruit-test.js             # 新增 100 条测试口令
 *   node scripts/seed-fruit-test.js --count=50  # 自定义条数
 *   node scripts/seed-fruit-test.js --clean     # 清理全部测试口令
 */
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const COLLECTION = 'fruit_links'
const BATCH_SIZE = 25
const OPENID_PREFIX = 'test_seed_'
const CODE_BASE = 83000000 // 8 位数字口令，83000001 起递增
const DEFAULT_COUNT = 100

/** 读取 cloudbaserc.json 中的环境 ID */
function readEnvId() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'cloudbaserc.json'), 'utf8'))
    return cfg.envId || ''
  } catch (e) {
    return ''
  }
}

/** 定位全局安装的 CloudBase CLI 入口（用 node 直接跑，避免 cmd 的引号转义问题） */
function findCliEntry() {
  const candidates = [
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@cloudbase', 'cli', 'bin', 'tcb'),
    'C:\\Program Files\\nodejs\\node_global\\node_modules\\@cloudbase\\cli\\bin\\tcb',
    '/usr/local/lib/node_modules/@cloudbase/cli/bin/tcb',
    '/usr/lib/node_modules/@cloudbase/cli/bin/tcb'
  ]
  return candidates.find(p => p && fs.existsSync(p)) || ''
}

/** 北京时间字符串 YYYY-MM-DD HH:mm:ss */
function bjTime(date) {
  return new Date(date.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')
}

/** 执行一次 MgoCommands 调用 */
function execMgo(cliEntry, envId, tableName, commandType, command) {
  const payload = JSON.stringify([{ TableName: tableName, CommandType: commandType, Command: JSON.stringify(command) }])
  const res = spawnSync(process.execPath, [cliEntry, 'db', 'nosql', 'execute', '-e', envId, '--command', payload, '--json'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  })
  const out = `${res.stdout || ''}${res.stderr || ''}`
  if (out.includes('"error"') && !out.includes('"ok"')) {
    throw new Error(out.replace(/\s+/g, ' ').slice(0, 400))
  }
  if (res.status !== 0) throw new Error(`CLI exit ${res.status}: ${out.replace(/\s+/g, ' ').slice(0, 400)}`)
  return out
}

/** 生成测试口令文档 */
function buildDocs(count) {
  const now = Date.now()
  const docs = []
  for (let i = 1; i <= count; i++) {
    const t = bjTime(new Date(now - i * 60 * 1000)) // 依次早 1 分钟，列表倒序看起来自然
    docs.push({
      openid: `${OPENID_PREFIX}${String(i).padStart(4, '0')}`,
      content: String(CODE_BASE + i),
      status: 'active',
      help_count: 0,
      is_test: true,
      created_at: t,
      updated_at: t,
      _v: 0
    })
  }
  return docs
}

function main() {
  const args = process.argv.slice(2)
  const clean = args.includes('--clean')
  const countArg = args.find(a => a.startsWith('--count='))
  const count = countArg ? Math.max(1, parseInt(countArg.split('=')[1], 10) || DEFAULT_COUNT) : DEFAULT_COUNT

  const envId = readEnvId()
  const cliEntry = findCliEntry()
  if (!envId) return console.error('[seed] 未读取到 cloudbaserc.json 中的 envId')
  if (!cliEntry) return console.error('[seed] 未找到 CloudBase CLI，请先执行 npm i -g @cloudbase/cli 并 tcb login')

  if (clean) {
    execMgo(cliEntry, envId, COLLECTION, 'DELETE', {
      delete: COLLECTION,
      deletes: [{ q: { is_test: true }, limit: 0 }]
    })
    console.log('[seed] 已清理全部测试口令（is_test: true）')
    return
  }

  const docs = buildDocs(count)
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE)
    execMgo(cliEntry, envId, COLLECTION, 'INSERT', { insert: COLLECTION, documents: batch })
    console.log(`[seed] 已插入 ${i + batch.length}/${docs.length}`)
  }
  console.log(`[seed] 完成，共新增 ${docs.length} 条测试口令；清理请执行 node scripts/seed-fruit-test.js --clean`)
}

main()
