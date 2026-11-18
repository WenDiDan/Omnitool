/**
 * 窄屏（手机/小平板）检测
 *
 * 用途：手机端表格列太多时横向滚动体验差，各页面据此只保留关键列
 * 断点与 style.css 的移动端媒体查询保持一致（820px）
 */
import { ref, onMounted, onUnmounted } from 'vue'

export function useIsMobile(breakpoint = 820) {
  const isMobile = ref(typeof window !== 'undefined' && window.innerWidth <= breakpoint)

  function update() {
    isMobile.value = window.innerWidth <= breakpoint
  }

  onMounted(() => window.addEventListener('resize', update))
  onUnmounted(() => window.removeEventListener('resize', update))

  return isMobile
}
