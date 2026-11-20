<template>
  <div class="shell" :class="{ collapsed }">
    <!-- 侧边工作台导航 -->
    <aside class="side">
      <button class="brand" title="回到仪表盘" @click="go('/dashboard')">
        <img class="brand-mark" :src="logoUrl" alt="AtoZ" />
        <span v-if="!collapsed" class="brand-text">
          <span class="brand-name">AtoZ</span>
          <span class="brand-sub">个人工作台</span>
        </span>
      </button>

      <button class="cmd-trigger" :class="{ mini: collapsed }" title="搜索或跳转（Ctrl K）" @click="openPalette">
        <el-icon><Search /></el-icon>
        <span v-if="!collapsed" class="cmd-label">搜索或跳转</span>
        <kbd v-if="!collapsed">Ctrl K</kbd>
      </button>

      <nav class="nav" aria-label="主导航">
        <template v-for="group in navGroups" :key="group.title">
          <div v-if="!collapsed" class="nav-group">{{ group.title }}</div>
          <div v-else class="nav-rule" />
          <button
            v-for="item in group.items"
            :key="item.path"
            class="nav-item"
            :class="{ active: item.path === activePath }"
            :title="collapsed ? item.title : undefined"
            @click="go(item.path)"
          >
            <el-icon class="nav-icon"><component :is="item.icon" /></el-icon>
            <span v-if="!collapsed" class="nav-label">{{ item.title }}</span>
            <span v-if="!collapsed && item.hint" class="nav-hint">{{ item.hint }}</span>
          </button>
        </template>
      </nav>

      <div class="side-foot">
        <button class="nav-item" :title="isDark ? '切换到浅色' : '切换到深色'" @click="switchTheme">
          <el-icon class="nav-icon">
            <Sunny v-if="isDark" />
            <Moon v-else />
          </el-icon>
          <span v-if="!collapsed" class="nav-label">{{ isDark ? '浅色模式' : '深色模式' }}</span>
        </button>
        <button
          class="nav-item"
          :class="{ active: route.path === '/settings' }"
          title="设置"
          @click="go('/settings')"
        >
          <el-icon class="nav-icon"><Setting /></el-icon>
          <span v-if="!collapsed" class="nav-label">设置</span>
        </button>
        <button class="collapse-btn" :title="collapsed ? '展开侧栏' : '收起侧栏'" @click="toggleCollapse">
          <el-icon><Expand v-if="collapsed" /><Fold v-else /></el-icon>
          <span v-if="!collapsed">收起</span>
        </button>
      </div>
    </aside>

    <!-- 内容区 -->
    <main class="content">
      <router-view v-slot="{ Component }">
        <transition name="swap" mode="out-in">
          <!-- keep-alive 缓存各页面实例：切回时免重挂载/重拉数据/重建编辑器 -->
          <keep-alive>
            <component :is="Component" />
          </keep-alive>
        </transition>
      </router-view>
    </main>

    <!-- 命令面板 -->
    <teleport to="body">
      <div v-if="paletteOpen" class="palette-mask" @mousedown.self="closePalette">
        <div class="palette" role="dialog" aria-modal="true" aria-label="命令面板">
          <div class="palette-input">
            <el-icon class="pi-search"><Search /></el-icon>
            <input
              ref="paletteInput"
              v-model="keyword"
              placeholder="输入页面名称或操作…"
              @keydown.down.prevent="move(1)"
              @keydown.up.prevent="move(-1)"
              @keydown.enter.prevent="runActive"
              @keydown.esc.prevent="closePalette"
            />
            <kbd>Esc</kbd>
          </div>

          <div class="palette-list">
            <template v-for="group in paletteGroups" :key="group.title">
              <div class="palette-group">{{ group.title }}</div>
              <button
                v-for="item in group.items"
                :key="item.id"
                class="palette-item"
                :class="{ active: item.id === activeId }"
                @mouseenter="activeId = item.id"
                @click="run(item)"
              >
                <el-icon class="pi-icon"><component :is="item.icon" /></el-icon>
                <span class="pi-title">{{ item.title }}</span>
                <span class="pi-hint">{{ item.hint }}</span>
              </button>
            </template>
            <div v-if="!flatCommands.length" class="palette-empty">没有匹配项</div>
          </div>

          <div class="palette-foot">
            <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
            <span><kbd>Enter</kbd> 执行</span>
            <span><kbd>Esc</kbd> 关闭</span>
          </div>
        </div>
      </div>
    </teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Document,
  Expand,
  Finished,
  Fold,
  MagicStick,
  Moon,
  Odometer,
  Plus,
  Search,
  Setting,
  SetUp,
  Suitcase,
  Sunny,
  Switch
} from '@element-plus/icons-vue'
import type { Component } from 'vue'
import logoUrl from './assets/logo.png'
import { pluginRegistry } from './plugins/store'
import { getThemeMeta, getSavedThemeId, onThemeChange, toggleThemeMode } from './theme'

const route = useRoute()
const router = useRouter()

// ---- 侧栏折叠（记忆） ----
const COLLAPSE_KEY = 'mydash:sidebar-collapsed'
const collapsed = ref(localStorage.getItem(COLLAPSE_KEY) === '1')

function toggleCollapse(): void {
  collapsed.value = !collapsed.value
  localStorage.setItem(COLLAPSE_KEY, collapsed.value ? '1' : '0')
}

// ---- 导航 ----
interface NavItem {
  path: string
  title: string
  icon: Component
  hint?: string
}

const navGroups = computed<{ title: string; items: NavItem[] }[]>(() => {
  const groups: { title: string; items: NavItem[] }[] = [
    {
      title: '工作区',
      items: [
        { path: '/dashboard', title: '仪表盘', icon: Odometer, hint: '总览' },
        { path: '/notes', title: '笔记', icon: Document },
        { path: '/todos', title: '待办', icon: Finished }
      ]
    },
    {
      title: '工具与智能',
      items: [
        { path: '/toolbox', title: '工具箱', icon: Suitcase },
        { path: '/ai', title: 'AI 工作台', icon: MagicStick }
      ]
    }
  ]
  if (pluginRegistry.pages.length) {
    groups.push({
      title: '扩展',
      items: pluginRegistry.pages.map((p) => ({
        path: p.path,
        title: p.title,
        icon: (p.icon as Component | undefined) ?? SetUp
      }))
    })
  }
  return groups
})

// /toolbox/:toolId 深链时仍高亮「工具箱」
const activePath = computed(() => (route.path.startsWith('/toolbox') ? '/toolbox' : route.path))

function go(path: string): void {
  closePalette()
  if (route.path !== path) void router.push(path)
}

// ---- 主题 ----
const currentTheme = ref(getSavedThemeId())
const isDark = computed(() => getThemeMeta(currentTheme.value).mode === 'dark')
let offTheme: (() => void) | null = null

function switchTheme(): void {
  toggleThemeMode()
}

// ---- 命令面板 ----
interface Command {
  id: string
  title: string
  hint: string
  icon: Component
  group: string
  keywords: string
  run: () => void
}

const paletteOpen = ref(false)
const keyword = ref('')
const activeId = ref('')
const paletteInput = ref<HTMLInputElement>()

const commands = computed<Command[]>(() => {
  const nav: Command[] = navGroups.value.flatMap((g) =>
    g.items.map((item) => ({
      id: `nav:${item.path}`,
      title: item.title,
      hint: '跳转',
      icon: item.icon,
      group: '页面',
      keywords: `${item.title} ${item.path}`,
      run: () => go(item.path)
    }))
  )
  const actions: Command[] = [
    {
      id: 'action:new-note',
      title: '新建笔记',
      hint: '笔记',
      icon: Plus,
      group: '操作',
      keywords: 'xinjian biji note new',
      run: () => {
        go('/notes')
        window.setTimeout(() => window.dispatchEvent(new CustomEvent('mydash:new-note')), 60)
      }
    },
    {
      id: 'action:new-todo',
      title: '新建待办',
      hint: '待办',
      icon: Plus,
      group: '操作',
      keywords: 'xinjian daiban todo new',
      run: () => {
        go('/todos')
        window.setTimeout(() => window.dispatchEvent(new CustomEvent('mydash:new-todo')), 60)
      }
    },
    {
      id: 'action:theme',
      title: isDark.value ? '切换到浅色模式' : '切换到深色模式',
      hint: '外观',
      icon: Switch,
      group: '操作',
      keywords: 'zhuti theme dark light',
      run: switchTheme
    }
  ]
  return [...nav, ...actions]
})

const flatCommands = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return commands.value
  return commands.value.filter(
    (c) => c.title.toLowerCase().includes(kw) || c.keywords.includes(kw) || c.hint.includes(kw)
  )
})

const paletteGroups = computed(() => {
  const groups = new Map<string, Command[]>()
  for (const c of flatCommands.value) {
    const list = groups.get(c.group) ?? []
    list.push(c)
    groups.set(c.group, list)
  }
  return [...groups.entries()].map(([title, items]) => ({ title, items }))
})

function openPalette(): void {
  paletteOpen.value = true
  keyword.value = ''
  activeId.value = flatCommands.value[0]?.id ?? ''
  void nextTick(() => paletteInput.value?.focus())
}

function closePalette(): void {
  paletteOpen.value = false
}

function move(step: number): void {
  const list = flatCommands.value
  if (!list.length) return
  const idx = list.findIndex((c) => c.id === activeId.value)
  const next = (idx + step + list.length) % list.length
  activeId.value = list[next].id
}

function runActive(): void {
  const item = flatCommands.value.find((c) => c.id === activeId.value) ?? flatCommands.value[0]
  if (item) run(item)
}

function run(item: Command): void {
  closePalette()
  item.run()
}

function onKeydown(e: KeyboardEvent): void {
  const isPaletteKey = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'
  if (isPaletteKey) {
    e.preventDefault()
    paletteOpen.value ? closePalette() : openPalette()
    return
  }
  if (e.key === 'Escape' && paletteOpen.value) closePalette()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  offTheme = onThemeChange((id) => (currentTheme.value = id))
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  offTheme?.()
  offTheme = null
})
</script>

<style scoped>
.shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

/* ---------------- 侧栏 ---------------- */
.side {
  width: var(--sidebar-w);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 12px 12px;
  background: color-mix(in srgb, var(--surface-1) 82%, transparent);
  border-right: 1px solid var(--line);
  transition: width var(--dur) var(--ease);
}

.collapsed .side {
  width: var(--sidebar-w-collapsed);
  padding: 14px 8px 12px;
}

.collapsed .brand {
  justify-content: center;
  padding-left: 0;
  padding-right: 0;
}

.collapsed .nav-item,
.collapsed .collapse-btn {
  justify-content: center;
  padding-left: 0;
  padding-right: 0;
}

.collapsed .nav-item.active::before {
  left: -2px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 6px 10px;
  border: none;
  background: none;
  cursor: pointer;
  text-align: left;
  color: inherit;
}

.brand-mark {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  padding: 3px;
  flex-shrink: 0;
  background: var(--surface-2);
  box-shadow: inset 0 0 0 1px var(--line);
}

.brand-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.brand-name {
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.01em;
  line-height: 1.2;
  color: var(--ink-1);
}

.brand-sub {
  font-size: 11px;
  color: var(--ink-3);
  letter-spacing: 0.04em;
}

/* 命令入口 */
.cmd-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--ink-3);
  font-size: 12.5px;
  cursor: pointer;
  transition:
    border-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.cmd-trigger:hover {
  border-color: var(--line-strong);
  color: var(--ink-2);
}

.cmd-trigger.mini {
  justify-content: center;
  padding: 7px 0;
}

.cmd-label {
  flex: 1;
  text-align: left;
}

kbd {
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 2px 5px;
  border-radius: 4px;
  border: 1px solid var(--line);
  background: var(--surface-1);
  color: var(--ink-3);
  line-height: 1.3;
}

/* 导航 */
.nav {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 4px;
}

.nav-group {
  padding: 10px 10px 4px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-3);
}

.nav-rule {
  height: 1px;
  margin: 8px 6px;
  background: var(--divider);
}

.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--ink-2);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.nav-item:hover {
  background: var(--fill-hover);
  color: var(--ink-1);
}

.nav-item.active {
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-weight: 600;
}

.nav-item.active::before {
  content: '';
  position: absolute;
  left: -6px;
  top: 50%;
  width: 3px;
  height: 16px;
  margin-top: -8px;
  border-radius: 2px;
  background: var(--accent);
}

.nav-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.nav-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-hint {
  font-size: 10.5px;
  color: var(--ink-3);
}

.side-foot {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 8px;
  border-top: 1px solid var(--divider);
}

.collapse-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  padding: 7px 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--ink-3);
  font-size: 12px;
  cursor: pointer;
}

.collapse-btn:hover {
  background: var(--fill-hover);
  color: var(--ink-2);
}

/* ---------------- 内容 ---------------- */
.content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 20px 24px 22px;
}

/* 路由切换：短促淡入位移 */
.swap-enter-active,
.swap-leave-active {
  transition:
    opacity 0.12s var(--ease),
    transform 0.12s var(--ease);
}

.swap-enter-from {
  opacity: 0;
  transform: translateY(5px);
}

.swap-leave-to {
  opacity: 0;
  transform: translateY(-3px);
}

/* ---------------- 命令面板 ---------------- */
.palette-mask {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  background: rgba(8, 9, 12, 0.44);
  animation: mask-in 0.12s ease both;
}

.palette {
  width: min(560px, 92vw);
  background: var(--overlay-glass);
  border: 1px solid var(--line-strong);
  border-radius: 14px;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  animation: palette-in 0.16s var(--ease) both;
}

.palette-input {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 13px 14px;
  border-bottom: 1px solid var(--divider);
}

.pi-search {
  color: var(--ink-3);
}

.palette-input input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--ink-1);
  font-size: 14px;
  font-family: var(--font-sans);
}

.palette-input input::placeholder {
  color: var(--ink-3);
}

.palette-list {
  max-height: 52vh;
  overflow-y: auto;
  padding: 6px;
}

.palette-group {
  padding: 8px 10px 4px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-3);
}

.palette-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--ink-2);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.palette-item.active {
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.pi-icon {
  font-size: 15px;
}

.pi-title {
  flex: 1;
}

.pi-hint {
  font-size: 11px;
  color: var(--ink-3);
}

.palette-empty {
  padding: 28px 12px;
  text-align: center;
  color: var(--ink-3);
  font-size: 12.5px;
}

.palette-foot {
  display: flex;
  gap: 16px;
  padding: 9px 14px;
  border-top: 1px solid var(--divider);
  color: var(--ink-3);
  font-size: 11px;
}

.palette-foot span {
  display: flex;
  align-items: center;
  gap: 4px;
}

@keyframes palette-in {
  from {
    opacity: 0;
    transform: translateY(-6px) scale(0.99);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes mask-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
</style>
