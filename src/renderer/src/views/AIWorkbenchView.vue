<template>
  <div class="page ai-page">
    <header class="page-head">
      <div>
        <h1>AI 工作台</h1>
        <p class="sub">统一管理模型供应商，调用兼容 chat / responses / messages 协议的网关</p>
      </div>
      <el-segmented v-model="active" :options="sections" class="ai-tabs" />
    </header>

    <!-- 内容面板；AI 助手需要满幅布局，去掉内边距与滚动 -->
    <div class="glass content-panel" :class="{ flush: active === 'agent' }">
      <ProviderManager v-show="active === 'providers'" />
      <AgentWorkbench v-show="active === 'agent'" />
      <ImageGen v-show="active === 'image'" />
      <UsageStats v-show="active === 'usage'" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import ProviderManager from '../components/ai/ProviderManager.vue'
import AgentWorkbench from '../components/ai/AgentWorkbench.vue'
import ImageGen from '../components/ai/ImageGen.vue'
import UsageStats from '../components/ai/UsageStats.vue'
import { useAiProviders } from '../ai/store'

defineOptions({ name: 'AIWorkbenchView' })

type SectionId = 'providers' | 'agent' | 'image' | 'usage'
const active = ref<SectionId>('providers')
const sections = [
  { label: '供应商', value: 'providers' },
  { label: 'AI 助手', value: 'agent' },
  { label: 'AI 生图', value: 'image' },
  { label: '用量统计', value: 'usage' }
]
const { ensureLoaded } = useAiProviders()

onMounted(() => {
  void ensureLoaded()
})
</script>

<style scoped>
.ai-page {
  height: 100%;
  overflow: hidden;
  gap: 14px;
}

.ai-tabs {
  flex-shrink: 0;
  align-self: flex-end;
}

.ai-tabs :deep(.el-segmented__item) {
  padding: 0 14px;
}

.content-panel {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 20px;
}

.content-panel.flush {
  padding: 0;
  overflow: hidden;
}
</style>
