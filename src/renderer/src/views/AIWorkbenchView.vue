<template>
  <div class="page ai-page">
    <header class="page-head">
      <div>
        <h1>AI 工作台</h1>
        <p class="sub">统一管理模型供应商，调用兼容 chat / responses / messages 协议的网关</p>
      </div>
    </header>

    <div class="ai-layout">
      <!-- 左侧竖向分类菜单 -->
      <div class="glass nav-panel">
        <el-menu :default-active="active" class="ai-menu" @select="onSelect">
          <el-menu-item index="providers">
            <el-icon><Connection /></el-icon>
            <span>供应商管理</span>
          </el-menu-item>
          <el-menu-item index="image">
            <el-icon><Picture /></el-icon>
            <span>AI 生图</span>
          </el-menu-item>
          <el-menu-item index="usage">
            <el-icon><DataAnalysis /></el-icon>
            <span>用量统计</span>
          </el-menu-item>
        </el-menu>
      </div>

      <!-- 右侧内容面板 -->
      <div class="glass content-panel">
        <ProviderManager v-show="active === 'providers'" />
        <ImageGen v-show="active === 'image'" />
        <UsageStats v-show="active === 'usage'" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Connection, DataAnalysis, Picture } from '@element-plus/icons-vue'
import ProviderManager from '../components/ai/ProviderManager.vue'
import ImageGen from '../components/ai/ImageGen.vue'
import UsageStats from '../components/ai/UsageStats.vue'
import { useAiProviders } from '../ai/store'

defineOptions({ name: 'AIWorkbenchView' })

const active = ref<'providers' | 'image' | 'usage'>('providers')
const { ensureLoaded } = useAiProviders()

function onSelect(id: string): void {
  active.value = id as 'providers' | 'image' | 'usage'
}

onMounted(() => {
  void ensureLoaded()
})
</script>

<style scoped>
.ai-page {
  height: 100%;
  overflow: hidden;
}

.ai-layout {
  display: flex;
  align-items: stretch;
  gap: 16px;
  flex: 1;
  min-height: 0;
}

.nav-panel {
  width: 168px;
  flex-shrink: 0;
  padding: 10px;
  overflow-y: auto;
}

.ai-menu {
  border-right: none;
  background: transparent;
}

.ai-menu :deep(.el-menu-item) {
  height: 40px;
  border-radius: var(--radius-sm);
  color: var(--ink-2);
  transition: background 0.2s ease, color 0.2s ease;
}

.ai-menu :deep(.el-menu-item:hover) {
  background: var(--fill-hover);
  color: var(--ink-1);
}

.ai-menu :deep(.el-menu-item.is-active) {
  background: var(--accent-soft);
  color: var(--accent-strong);
  box-shadow: inset 0 0 0 1px var(--accent-border);
}

.content-panel {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 18px 20px;
}
</style>
