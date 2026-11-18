import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  // file:// 协议下必须用 hash 模式
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: '/dashboard'
    },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: () => import('../views/DashboardView.vue'),
      meta: { title: '仪表盘' }
    },
    {
      path: '/notes',
      name: 'notes',
      component: () => import('../views/NotesView.vue'),
      meta: { title: '笔记' }
    },
    {
      path: '/todos',
      name: 'todos',
      component: () => import('../views/TodosView.vue'),
      meta: { title: '待办' }
    },
    {
      // 可选 toolId 参数：深链直达某工具（/toolbox/json-formatter）
      path: '/toolbox/:toolId?',
      name: 'toolbox',
      component: () => import('../views/ToolboxView.vue'),
      meta: { title: '工具箱' }
    },
    {
      path: '/ai',
      name: 'ai',
      component: () => import('../views/AIWorkbenchView.vue'),
      meta: { title: 'AI 工作台' }
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/SettingsView.vue'),
      meta: { title: '设置' }
    }
  ]
})

export default router
