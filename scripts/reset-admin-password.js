/**
 * 重置后台超管密码（bcrypt 不可解密，只能重置）
 *
 * 用法：node scripts/reset-admin-password.js <新密码>
 * 要求：8 位以上且包含字母和数字（与后台校验规则一致）
 *
 * 说明：
 *  - 直接改写 admin_users.passwordHash，同时清空登录失败计数、锁定状态与旧会话
 *  - 重置后所有已登录设备会被踢出，需重新登录
 */
const { spawnSync } = require('child_process')
const path = require('path')

const CLI = 'C:/Program Files/nodejs/node_global/node_modules/@cloudbase/cli/bin/tcb'
const ENV = 'wendi-d5gnswjf75b25aac0'
const USERNAME = 'Wendi'

// 命令行传参时 Windows 可能把引号一起带进来，这里统一剥离
const raw = process.argv.slice(2).join(' ').trim().replace(/^["']|["']$/g, '')
const pwd = raw
if (!pwd) { console.error('用法：node scripts/reset-admin-password.js <新密码>'); process.exit(1) }
if (!/^(?=.*[a-zA-Z])(?=.*\d).{8,}$/.test(pwd)) {
  console.error('密码须 8 位以上且包含字母和数字')
  process.exit(1)
}

const bcrypt = require('bcryptjs')
const hash = bcrypt.hashSync(pwd, 10)
if (!bcrypt.compareSync(pwd, hash)) { console.error('hash 自校验失败'); process.exit(1) }
console.log('新密码已哈希（cost 10）')

// 更新：改 hash + 清失败计数/锁定/会话
const command = JSON.stringify([{
  TableName: 'admin_users',
  CommandType: 'COMMAND',
  Command: JSON.stringify({
    update: 'admin_users',
    updates: [{
      q: { username: USERNAME },
      u: {
        $set: {
          passwordHash: hash,
          loginFails: 0,
          lockUntil: '',
          sessionToken: '',
          sessionExpiresAt: ''
        }
      }
    }]
  })
}])

const r = spawnSync(process.execPath, [CLI, 'db', 'nosql', 'execute', '-e', ENV, '--command', command, '--json'], {
  encoding: 'utf8',
  timeout: 90000
})
const out = ((r.stdout || '') + (r.stderr || '')).replace(/\x1b\[[0-9;]*m/g, '')
if (!/nModified|n":\s*1|ok/i.test(out)) {
  console.error('更新可能失败，原始输出：')
  console.error(out.slice(-600))
  process.exit(1)
}

// 回读校验
const verify = JSON.stringify([{
  TableName: 'admin_users',
  CommandType: 'QUERY',
  Command: JSON.stringify({ find: 'admin_users', filter: { username: USERNAME }, limit: 1 })
}])
const r2 = spawnSync(process.execPath, [CLI, 'db', 'nosql', 'execute', '-e', ENV, '--command', verify, '--json'], {
  encoding: 'utf8',
  timeout: 90000
})
const out2 = ((r2.stdout || '') + (r2.stderr || '')).replace(/\x1b\[[0-9;]*m/g, '')
// 返回结构：{ data: { results: [ [row] ] } }
let row = null
const m = out2.match(/\{[\s\S]*\}/)
if (m) {
  try {
    const j = JSON.parse(m[0])
    const results = (j.data && j.data.results) || []
    row = (results[0] && results[0][0]) || null
  } catch (e) { /* 走下方失败分支 */ }
}

if (!row) { console.error('回读失败'); process.exit(1) }
const ok = bcrypt.compareSync(pwd, row.passwordHash || '')
console.log(`✔ 账号 ${row.username} 密码已重置`)
console.log(`  hash 校验：${ok ? '通过' : '失败'}`)
console.log(`  锁定状态：${row.lockUntil || '无'} | 失败次数：${row.loginFails || 0} | 会话：${row.sessionToken ? '仍存在' : '已清空'}`)
if (!ok) process.exit(1)
