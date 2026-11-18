/**
 * 校验某个候选密码是否与后台账号当前密码一致
 *
 * 用法：node scripts/check-password.js 候选密码1 [候选密码2 ...]
 * 原理：读出库里的 bcrypt hash，用相同 salt+cost 对候选密码重新计算并比对
 *       （与登录时的校验逻辑完全一致，不涉及任何"解密"）
 */
const { spawnSync } = require('child_process')
const bcrypt = require('bcryptjs')

const CLI = 'C:/Program Files/nodejs/node_global/node_modules/@cloudbase/cli/bin/tcb'
const ENV = 'wendi-d5gnswjf75b25aac0'
const USERNAME = 'Wendi'

const candidates = process.argv.slice(2)
if (!candidates.length) {
  console.error('用法：node scripts/check-password.js 候选密码1 [候选密码2 ...]')
  process.exit(1)
}

const cmd = JSON.stringify([{
  TableName: 'admin_users',
  CommandType: 'QUERY',
  Command: JSON.stringify({ find: 'admin_users', filter: { username: USERNAME }, limit: 1 })
}])
const r = spawnSync(process.execPath, [CLI, 'db', 'nosql', 'execute', '-e', ENV, '--command', cmd, '--json'], {
  encoding: 'utf8',
  timeout: 90000
})
const out = ((r.stdout || '') + (r.stderr || '')).replace(/\x1b\[[0-9;]*m/g, '')
const m = out.match(/\{[\s\S]*\}/)
let row = null
if (m) {
  try {
    const j = JSON.parse(m[0])
    row = ((j.data && j.data.results) || [])[0]?.[0] || null
  } catch (e) { /* 走失败分支 */ }
}
if (!row) { console.error('读取账号失败'); process.exit(1) }

console.log(`账号：${row.username}（${row.role}）`)
console.log(`hash 前缀：${String(row.passwordHash || '').slice(0, 7)}（版本 + cost）`)
console.log(`上次登录：${row.lastLoginAt || '-'}\n`)

let hit = null
for (const pwd of candidates) {
  const ok = bcrypt.compareSync(pwd, row.passwordHash || '')
  console.log(`${ok ? '✔ 匹配' : '✘ 不匹配'}  ${pwd.slice(0, 2)}${'*'.repeat(Math.max(0, pwd.length - 2))}`)
  if (ok && !hit) hit = pwd
}

console.log(hit ? `\n当前密码就是：${hit}` : '\n以上候选都不对——建议直接重置（node scripts/reset-admin-password.js 新密码）')
