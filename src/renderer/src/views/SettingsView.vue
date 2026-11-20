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
          <el-menu-item index="notify">
            <el-icon><Bell /></el-icon>
            <span>通知提醒</span>
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
              <div class="row-desc">登录系统后自动启动 AtoZ 并收纳到托盘</div>
            </div>
            <el-switch
              :model-value="openAtLogin"
              :loading="loginSwitching"
              @change="setLoginItem"
            />
          </div>

          <div class="section-head attach-head">
            <div>
              <div class="row-title">图片附件</div>
              <div class="row-desc">
                笔记中粘贴 / 拖拽的图片按内容寻址存放；共 {{ attachStats.count }} 张，占用
                {{ (attachStats.bytes / 1024 / 1024).toFixed(1) }} MB。清理只删除未被任何笔记（含历史版本）引用的图片。
              </div>
            </div>
          </div>
          <div class="attach-actions">
            <el-button size="small" @click="refreshAttachStats">刷新</el-button>
            <el-button size="small" @click="openAttachDir">打开附件目录</el-button>
            <el-button
              size="small"
              type="danger"
              plain
              :loading="attachGcRunning"
              @click="gcAttachments"
            >清理未引用附件</el-button>
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
              <span class="preview" :style="{ background: t.preview[0] }">
                <span class="pv-card" :style="{ background: t.preview[1] }">
                  <span class="pv-line" :style="{ background: t.preview[2] }" />
                  <span class="pv-line short" />
                </span>
                <span class="pv-dot" :style="{ background: t.preview[2] }" />
              </span>
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

        <!-- 通知提醒 -->
        <div v-show="active === 'notify'" class="section">
          <NotifySettingsPanel />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { Bell, Box, Check, Brush, InfoFilled, SwitchButton, UploadFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { applyTheme, getSavedThemeId, THEMES, type ThemeMeta } from '../theme'
import { appMeta } from '../api/http'
import PluginSettingsPanel from '../components/PluginSettingsPanel.vue'
import SyncSettingsPanel from '../components/SyncSettingsPanel.vue'
import NotifySettingsPanel from '../components/NotifySettingsPanel.vue'

type SectionId = 'general' | 'appearance' | 'plugins' | 'sync' | 'notify' | 'about'

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

// 主题卡片预览用三色拼一个迷你界面（背景 / 面板 / 主色），比纯渐变更容易区分

async function setLoginItem(open: boolean | string | number): Promise<void> {
  loginSwitching.value = true
  try {
    await window.api.settings.setLoginItem(Boolean(open))
    openAtLogin.value = Boolean(open)
  } finally {
    loginSwitching.value = false
  }
}

// ---- 图片附件 ----
const attachStats = ref({ count: 0, bytes: 0 })
const attachGcRunning = ref(false)

async function refreshAttachStats(): Promise<void> {
  attachStats.value = await window.api.attachments.stats()
}

function openAttachDir(): void {
  void window.api.attachments.openDir()
}

async function gcAttachments(): Promise<void> {
  attachGcRunning.value = true
  try {
    const { deleted, freedBytes } = await window.api.attachments.gc()
    await refreshAttachStats()
    if (deleted === 0) ElMessage.info('没有需要清理的未引用附件')
    else ElMessage.success(`已清理 ${deleted} 张未引用图片，释放 ${(freedBytes / 1024 / 1024).toFixed(1)} MB`)
  } finally {
    attachGcRunning.value = false
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
  void refreshAttachStats()
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
  width: 176px;
  flex-shrink: 0;
  padding: 8px;
  overflow-y: auto;
}

.settings-menu {
  border-right: none;
  background: transparent;
}

.settings-menu :deep(.el-menu-item) {
  height: 36px;
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
  padding: 20px 22px;
}

/* 内容面板本身已经是卡片：内部的子面板（插件/同步/通知）不再重复画边框，
   否则会在面板内再出现一圈「框中框」。 */
.content-panel :deep(.panel) {
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
}

.section-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
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

.attach-head {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--divider);
  align-items: flex-start;
}

.attach-actions {
  display: flex;
  gap: 8px;
  padding: 2px 0 4px;
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
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
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
  position: relative;
  display: block;
  height: 76px;
  border-radius: 8px;
  border: 1px solid var(--divider);
  overflow: hidden;
}

.pv-card {
  position: absolute;
  left: 12px;
  right: 34px;
  top: 14px;
  bottom: 12px;
  border-radius: 6px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
}

.pv-line {
  height: 4px;
  width: 54%;
  border-radius: 2px;
  opacity: 0.9;
}

.pv-line.short {
  width: 32%;
  background: rgba(127, 127, 127, 0.4);
}

.pv-dot {
  position: absolute;
  right: 14px;
  top: 18px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
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
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 3px;
  font-size: 13px;
  border-radius: 50%;
  background: var(--surface-1);
  color: var(--accent);
  box-shadow: var(--shadow-sm);
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
