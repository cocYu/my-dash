<template>
  <div class="page settings-page">
    <header class="page-head">
      <div>
        <h1>设置</h1>
        <p class="sub">个性化应用外观与行为</p>
      </div>
    </header>

    <div class="settings-layout">
      <!-- 左侧竖向分类菜单 -->
      <div class="glass nav-panel">
        <el-menu :default-active="active" class="settings-menu" @select="onSectionSelect">
          <el-menu-item index="general">
            <el-icon><SwitchButton /></el-icon>
            <span>通用</span>
          </el-menu-item>
          <el-menu-item index="appearance">
            <el-icon><Brush /></el-icon>
            <span>外观</span>
          </el-menu-item>
          <el-menu-item index="plugins">
            <el-icon><Box /></el-icon>
            <span>插件</span>
          </el-menu-item>
          <el-menu-item index="sync">
            <el-icon><UploadFilled /></el-icon>
            <span>数据同步</span>
          </el-menu-item>
          <el-menu-item index="about">
            <el-icon><InfoFilled /></el-icon>
            <span>关于</span>
          </el-menu-item>
        </el-menu>
      </div>

      <!-- 右侧内容面板 -->
      <div class="glass content-panel">
        <!-- 通用 -->
        <div v-show="active === 'general'" class="section">
          <div class="section-head">
            <div>
              <div class="row-title">开机自启</div>
              <div class="row-desc">登录系统后自动启动 myDash 并收纳到托盘</div>
            </div>
            <el-switch
              :model-value="openAtLogin"
              :loading="loginSwitching"
              @change="setLoginItem"
            />
          </div>
        </div>

        <!-- 外观 -->
        <div v-show="active === 'appearance'" class="section">
          <div class="section-title">主题</div>
          <div class="theme-grid">
            <button
              v-for="t in THEMES"
              :key="t.id"
              class="theme-card"
              :class="{ active: t.id === currentTheme }"
              @click="selectTheme(t.id)"
            >
              <span class="preview" :style="{ background: previewStyle(t) }" />
              <span class="meta">
                <span class="name">{{ t.name }}</span>
                <el-tag size="small" effect="plain">{{ t.mode === 'dark' ? '深色' : '浅色' }}</el-tag>
              </span>
              <el-icon v-if="t.id === currentTheme" class="check"><Check /></el-icon>
            </button>
          </div>
          <div class="tip">切换即时生效，选择会被记住</div>
        </div>

        <!-- 关于 -->
        <div v-show="active === 'about'" class="section">
          <div class="about-row">
            <span class="k">应用版本</span>
            <span class="v">{{ appVersion || '…' }}</span>
          </div>
          <div class="about-row">
            <span class="k">运行环境</span>
            <span class="v">Electron {{ electronVersion }} · Go 后端已连接</span>
          </div>
          <div class="about-row">
            <span class="k">数据目录</span>
            <span class="v mono">{{ userDataPath || '…' }}</span>
          </div>
        </div>

        <!-- 插件 -->
        <div v-show="active === 'plugins'" class="section">
          <PluginSettingsPanel />
        </div>

        <!-- 数据同步 -->
        <div v-show="active === 'sync'" class="section">
          <SyncSettingsPanel />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { Box, Check, Brush, InfoFilled, SwitchButton, UploadFilled } from '@element-plus/icons-vue'
import { applyTheme, getSavedThemeId, THEMES, type ThemeMeta } from '../theme'
import { appMeta } from '../api/http'
import PluginSettingsPanel from '../components/PluginSettingsPanel.vue'
import SyncSettingsPanel from '../components/SyncSettingsPanel.vue'

type SectionId = 'general' | 'appearance' | 'plugins' | 'sync' | 'about'

const active = ref<SectionId>('general')
const currentTheme = ref(getSavedThemeId())
const appVersion = ref('')
const userDataPath = ref('')
const electronVersion = ref('')
const openAtLogin = ref(false)
const loginSwitching = ref(false)

watch(currentTheme, (id) => applyTheme(id))

function onSectionSelect(id: string): void {
  active.value = id as SectionId
}

function selectTheme(id: string): void {
  currentTheme.value = id
}

/** 主题卡片预览底：背景色 + 玻璃斑 + 主色光斑 */
function previewStyle(t: ThemeMeta): string {
  return `radial-gradient(circle at 78% 30%, ${t.preview[2]}66, transparent 62%),` +
    `radial-gradient(circle at 22% 75%, ${t.preview[1]}, ${t.preview[0]})`
}

async function setLoginItem(open: boolean | string | number): Promise<void> {
  loginSwitching.value = true
  try {
    await window.api.settings.setLoginItem(Boolean(open))
    openAtLogin.value = Boolean(open)
  } finally {
    loginSwitching.value = false
  }
}

onMounted(async () => {
  appVersion.value = appMeta.appVersion
  userDataPath.value = appMeta.userDataPath
  electronVersion.value = appMeta.electronVersion
  try {
    openAtLogin.value = (await window.api.settings.getLoginItem()).openAtLogin
  } catch {
    openAtLogin.value = false
  }
})
</script>

<style scoped>
/* 固定视口布局：页面不随外层滚动，左右两栏各自独立滚动 */
.settings-page {
  height: 100%;
  overflow: hidden;
}

.settings-layout {
  display: flex;
  align-items: stretch;
  gap: 16px;
  flex: 1;
  min-height: 0; /* 允许子项收缩，独立滚动生效的关键 */
}

/* 左侧分类菜单：固定，条目过多时菜单区独立滚动 */
.nav-panel {
  width: 168px;
  flex-shrink: 0;
  padding: 10px;
  overflow-y: auto;
}

.settings-menu {
  border-right: none;
  background: transparent;
}

.settings-menu :deep(.el-menu-item) {
  height: 40px;
  border-radius: var(--radius-sm);
  color: var(--ink-2);
  transition: background 0.2s ease, color 0.2s ease;
}

.settings-menu :deep(.el-menu-item:hover) {
  background: var(--fill-hover);
  color: var(--ink-1);
}

.settings-menu :deep(.el-menu-item.is-active) {
  background: var(--accent-soft);
  color: var(--accent-strong);
  box-shadow: inset 0 0 0 1px var(--accent-border);
}

/* 右侧内容：独立滚动 */
.content-panel {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 18px 20px;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--ink-3);
  margin-bottom: 12px;
}

/* 通用：设置行 */
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
}

.row-title {
  font-size: 14px;
  font-weight: 600;
}

.row-desc {
  margin-top: 4px;
  font-size: 12px;
  color: var(--ink-3);
}

/* 外观：主题卡片 */
.theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 12px;
}

.theme-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  background: var(--fill-subtle);
  color: inherit;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.2s ease, background 0.2s ease;
}

.theme-card:hover {
  border-color: var(--accent-border);
}

.theme-card.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.preview {
  height: 64px;
  border-radius: 8px;
  border: 1px solid var(--divider);
}

.meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.name {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
}

.check {
  color: var(--accent);
}

.tip {
  margin-top: 12px;
  font-size: 12px;
  color: var(--ink-3);
}

/* 关于 */
.about-row {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 11px 0;
  font-size: 13px;
}

.about-row + .about-row {
  border-top: 1px solid var(--divider);
}

.about-row .k {
  width: 84px;
  flex-shrink: 0;
  color: var(--ink-3);
}

.about-row .v {
  color: var(--ink-1);
}

.about-row .v.mono {
  font-size: 12px;
  word-break: break-all;
}
</style>
