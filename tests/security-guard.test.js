/**
 * 安全回归守卫：静态检查云函数里的敏感配置
 *
 * 只做源码扫描（不加载 wx-server-sdk），防止以下问题回潮：
 *  1. 初始化码/密钥硬编码；
 *  2. CORS 使用通配符 '*'；
 *  3. 初始化码比较用普通 ===（可能被时序侧信道猜解）。
 */
const fs = require('fs')
const path = require('path')

const ADMIN_API = path.join(__dirname, '../cloudfunctions/adminApi/index.js')
const src = fs.readFileSync(ADMIN_API, 'utf8')

describe('adminApi 安全配置', () => {
  test('初始化码不硬编码，必须来自环境变量', () => {
    expect(src).toMatch(/process\.env\.ADMIN_INIT_CODE/)
    // 任何形如 const INIT_CODE = 'xxx' 的明文赋值都不允许
    expect(src).not.toMatch(/const\s+INIT_CODE\s*=\s*['"`]/)
  })

  test('未配置初始化码时拒绝 admin.init', () => {
    expect(src).toMatch(/if\s*\(!INIT_CODE\)/)
  })

  test('初始化码使用定长比较', () => {
    expect(src).toMatch(/timingSafeEqual/)
  })

  test('CORS 不使用通配符，改为白名单回显', () => {
    expect(src).not.toMatch(/Access-Control-Allow-Origin'\s*:\s*'\*'/)
    expect(src).toMatch(/ALLOWED_ORIGINS/)
    expect(src).toMatch(/ADMIN_ALLOWED_ORIGINS/)
  })

  test('预检响应同样走白名单头', () => {
    const optIdx = src.indexOf("event.httpMethod === 'OPTIONS'")
    expect(optIdx).toBeGreaterThan(-1)
    const optBlock = src.slice(optIdx, optIdx + 240)
    expect(optBlock).toMatch(/corsHeaders/)
  })
})
