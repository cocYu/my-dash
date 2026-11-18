<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>仪表盘</h1>
        <p class="sub">{{ today }} · 插件提供的小组件都会汇聚在这里</p>
      </div>
    </header>

    <!-- 内置统计磁贴 -->
    <div class="stat-grid">
      <div class="glass stat-tile">
        <div class="label">笔记总数</div>
        <div class="value accent">{{ noteCount ?? '…' }}</div>
        <div class="hint">来自本地 SQLite</div>
      </div>
      <div class="glass stat-tile">
        <div class="label">已启用插件</div>
        <div class="value">{{ enabledPlugins }}</div>
        <div class="hint">已安装 {{ totalPlugins }} 个</div>
      </div>
      <div class="glass stat-tile">
        <div class="label">运行环境</div>
        <div class="value">{{ electronVersion }}</div>
        <div class="hint">Electron · Go 后端已连接</div>
      </div>
    </div>

    <!-- 插件小组件 -->
    <template v-if="pluginRegistry.widgets.length > 0">
      <div class="section-title">插件小组件</div>
      <div class="widget-grid">
        <el-card
          v-for="(w, i) in pluginRegistry.widgets"
          :key="w.id"
          shadow="never"
          class="widget"
          :style="{ animationDelay: `${i * 60}ms` }"
        >
          <template #header>
            <span class="widget-title">{{ w.title }}</span>
          </template>
          <component :is="w.component" />
        </el-card>
      </div>
    </template>
    <el-empty v-else description="暂无插件小组件，到「插件管理」安装后这里会展示卡片" class="empty glass" />
  </div>
</template>

<script setup lang="ts">
import { onActivated, onMounted, ref } from 'vue'
import { listNotes } from '../api/notes'
import { appMeta } from '../api/http'
import { pluginRegistry } from '../plugins/store'

const today = new Date().toLocaleDateString('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'long'
})

const noteCount = ref<number | null>(null)
const enabledPlugins = ref(0)
const totalPlugins = ref(0)
const electronVersion = `v${appMeta.electronVersion.split('.').slice(0, 2).join('.')}`

async function refresh(): Promise<void> {
  try {
    noteCount.value = (await listNotes()).length
  } catch {
    noteCount.value = 0
  }
  try {
    const list = await window.api.plugins.list()
    totalPlugins.value = list.filter((p) => !p.error).length
    enabledPlugins.value = list.filter((p) => p.enabled && !p.error).length
  } catch {
    enabledPlugins.value = 0
  }
}

onMounted(refresh)

// keep-alive 缓存页面：切回仪表盘时刷新统计，避免笔记/插件变动后数字过期
let activatedOnce = false
onActivated(() => {
  if (!activatedOnce) {
    activatedOnce = true
    return
  }
  void refresh()
})
</script>

<style scoped>
.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 300px;
}

.section-title {
  margin-top: 4px;
  padding: 0 4px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--ink-3);
}

.widget-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.widget {
  animation: widget-in 0.4s ease both;
}

.widget:hover {
  border-color: var(--accent-border);
  transform: translateY(-2px);
}

.widget-title {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--ink-2);
}

@keyframes widget-in {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
