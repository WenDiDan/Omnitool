/**
 * adminApi 请求封装
 * BASE_URL 可用环境变量 VITE_API_BASE 覆盖（部署时填静态托管同环境地址）
 */
import axios from 'axios'
import { MessagePlugin } from 'tdesign-vue-next'

export const API_BASE =
  import.meta.env.VITE_API_BASE ||
  'https://wendi-d5gnswjf75b25aac0.service.tcloudbase.com/adminApi'

const client = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' }
})

let expiredNotified = false

/** 会话失效统一处理：清 token + 提示一次 + 回登录页 */
function handleExpired(msg) {
  localStorage.removeItem('admin_token')
  localStorage.removeItem('admin_user')
  if (!expiredNotified) {
    expiredNotified = true
    MessagePlugin.warning(msg || '登录已过期，请重新登录')
    setTimeout(() => { expiredNotified = false }, 3000)
  }
  if (location.hash !== '#/login') location.hash = '#/login'
}

/** 统一 POST：自动带 token，会话失效时提示并踢回登录页 */
export async function api(action, params = {}) {
  const token = localStorage.getItem('admin_token') || ''
  try {
    // action 放最后合并：路由名不可被 params 里的同名键覆盖（如日志页的动作筛选）
    const { data } = await client.post('', { token, ...params, action })
    if (!data.ok && data.error && /重新登录|会话|登录已过期/.test(data.error)) {
      handleExpired(data.error)
    }
    return data
  } catch (e) {
    if (e.response && e.response.status === 401) {
      handleExpired('登录已过期，请重新登录')
      return { ok: false, error: '登录已过期' }
    }
    const msg = e.code === 'ECONNABORTED' ? '请求超时，请检查网络后重试' : (e.message || '网络请求失败')
    return { ok: false, error: msg }
  }
}
