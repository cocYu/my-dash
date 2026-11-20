<!-- 工具箱：左侧搜索+分类工具列表（内置与插件工具混排），右侧工作区。
     工作区套 keep-alive :max=6 —— 打开过的工具 LRU 缓存，内存有界、回访秒开。
     路由 /toolbox/:toolId? 支持深链直达某工具。 -->
<template>
  <div class="page toolbox-page">
    <!-- 左：工具列表 -->
    <div class="glass sidebar">
      <el-input v-model="keyword" placeholder="搜索工具…" :prefix-icon="Search" clearable size="small" />
      <div class="tool-list">
        <template v-for="group in grouped" :key="group.category">
          <div class="group-title">{{ group.category }}</div>
          <button
            v-for="tool in group.items"
            :key="tool.id"
            class="tool-item"
            :class="{ active: tool.id === activeId }"
            @click="open(tool)"
          >
            <el-icon class="tool-icon"><component :is="tool.icon ?? SetUp" /></el-icon>
            <span class="tool-name">{{ tool.name }}</span>
            <el-tag v-if="tool.fromPlugin" size="small" type="warning" effect="plain" class="src-tag">插件</el-tag>
          </button>
        </template>
        <EmptyState v-if="!grouped.length" compact title="没有匹配的工具" hint="试试更短的关键词" :icon="Search" />
      </div>
      <div class="sidebar-foot">
        <el-button size="small" class="foot-btn" @click="marketOpen = true">
          <el-icon><Shop /></el-icon>&nbsp;获取插件
        </el-button>
      </div>
    </div>

    <!-- 右：工具工作区 -->
    <div class="glass workspace">
      <template v-if="activeTool">
        <div class="ws-head">
          <el-icon class="ws-icon"><component :is="activeTool.icon ?? SetUp" /></el-icon>
          <div class="ws-meta">
            <div class="ws-name">
              {{ activeTool.name }}
              <el-tag v-if="activeTool.fromPlugin" size="small" type="warning" effect="plain">插件工具</el-tag>
            </div>
            <div v-if="activeTool.description" class="ws-desc">{{ activeTool.description }}</div>
          </div>
        </div>
        <div class="ws-body">
          <keep-alive :max="6">
            <component :is="activeTool.component" :key="activeTool.id" />
          </keep-alive>
        </div>
      </template>
      <div v-else class="ws-empty">
        <EmptyState title="选择一个工具开始" hint="左侧按分类列出所有内置与插件工具" :icon="SetUp" />
      </div>
    </div>

    <ToolMarketDialog v-model="marketOpen" />
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'ToolboxView' })
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Search, SetUp, Shop } from '@element-plus/icons-vue'
import { toolboxRegistry, type ToolMeta } from '../toolbox/registry'
import ToolMarketDialog from '../toolbox/ToolMarketDialog.vue'
import EmptyState from '../components/EmptyState.vue'

const route = useRoute()
const router = useRouter()

const keyword = ref('')
const marketOpen = ref(false)

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return toolboxRegistry.tools
  return toolboxRegistry.tools.filter(
    (t) => t.name.toLowerCase().includes(kw) || t.id.toLowerCase().includes(kw) || (t.description ?? '').toLowerCase().includes(kw)
  )
})

const grouped = computed(() => {
  const map = new Map<string, ToolMeta[]>()
  for (const t of filtered.value) {
    const list = map.get(t.category) ?? []
    list.push(t)
    map.set(t.category, list)
  }
  return [...map.entries()].map(([category, items]) => ({ category, items }))
})

const activeId = computed(() => (typeof route.params.toolId === 'string' ? route.params.toolId : ''))
const activeTool = computed(
  () => toolboxRegistry.tools.find((t) => t.id === activeId.value) ?? filtered.value[0] ?? null
)

function open(tool: ToolMeta): void {
  void router.push(`/toolbox/${tool.id}`)
}

// 插件重载后当前工具可能已不存在：路由参数失效时回落到首个工具
watch(
  () => toolboxRegistry.tools.length,
  () => {
    if (activeId.value && !toolboxRegistry.tools.some((t) => t.id === activeId.value)) {
      void router.replace('/toolbox')
    }
  }
)
</script>

<style scoped>
/* 覆盖 .page 默认纵向布局：工具箱为左右两栏 */
.toolbox-page {
  height: 100%;
  overflow: hidden;
  flex-direction: row;
  gap: 16px;
}

.sidebar {
  width: 248px;
  flex-shrink: 0;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: hidden;
}

.tool-list {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.group-title {
  font-size: 10.5px;
  text-transform: uppercase;
  font-weight: 600;
  color: var(--ink-3);
  letter-spacing: 0.08em;
  padding: 10px 8px 4px;
}

.tool-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  border: 1px solid transparent;
  background: none;
  color: var(--ink-2);
  text-align: left;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 13px;
  transition:
    background var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}

.tool-item:hover {
  background: var(--fill-hover);
}

.tool-item.active {
  background: var(--accent-soft);
  border-color: var(--accent-border);
  color: var(--accent-strong);
  font-weight: 600;
}

.tool-icon {
  flex-shrink: 0;
}

.tool-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.src-tag {
  flex-shrink: 0;
}

.sidebar-foot {
  border-top: 1px solid var(--divider);
  padding-top: 10px;
}

.foot-btn {
  width: 100%;
}

.workspace {
  flex: 1;
  min-width: 0;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ws-head {
  display: flex;
  gap: 10px;
  align-items: center;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--divider);
  margin-bottom: 14px;
}

.ws-icon {
  font-size: 20px;
  color: var(--accent);
}

.ws-name {
  font-size: 15px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

.ws-desc {
  font-size: 12px;
  color: var(--ink-3);
  margin-top: 2px;
}

.ws-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.ws-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
