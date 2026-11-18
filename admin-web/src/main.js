import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import TDesign from 'tdesign-vue-next'
import 'tdesign-vue-next/es/style/index.css'
import App from './App.vue'
import Login from './views/Login.vue'
import Layout from './views/Layout.vue'
import Tools from './views/Tools.vue'
import Users from './views/Users.vue'
import Mutual from './views/Mutual.vue'
import Logs from './views/Logs.vue'
import './style.css'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/login', component: Login },
    {
      path: '/',
      component: Layout,
      children: [
        { path: '', redirect: '/tools' },
        { path: 'tools', component: Tools },
        { path: 'users', component: Users },
        { path: 'mutual', component: Mutual },
        { path: 'logs', component: Logs }
      ]
    }
  ]
})

// 未登录跳转
router.beforeEach(to => {
  if (to.path !== '/login' && !localStorage.getItem('admin_token')) return '/login'
})

createApp(App).use(router).use(TDesign).mount('#app')
