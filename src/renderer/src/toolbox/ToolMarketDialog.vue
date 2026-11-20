<!-- 工具箱「获取插件」入口：直接复用设置页的插件市场组件，避免两套远程安装界面。
     插件源在 设置 → 插件 → 插件源 管理，这里只做快捷安装。 -->
<template>
  <el-dialog
    v-model="visible"
    title="获取插件"
    width="min(680px, 92vw)"
    :close-on-click-modal="false"
    @open="marketRef?.load()"
  >
    <PluginMarket ref="marketRef" @open-sources="goSources" />
    <template #footer>
      <div class="foot">
        <span class="foot-hint">插件在主世界运行，权限为声明式约束，请仅安装可信来源。</span>
        <el-button text @click="goSources">管理插件源</el-button>
        <el-button @click="visible = false">关闭</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import PluginMarket from '../components/plugins/PluginMarket.vue'

const visible = defineModel<boolean>({ default: false })
const router = useRouter()
const marketRef = ref<InstanceType<typeof PluginMarket>>()

function goSources(): void {
  visible.value = false
  void router.push({ path: '/settings', query: { section: 'plugins', tab: 'sources' } })
}
</script>

<style scoped>
.foot {
  display: flex;
  align-items: center;
  gap: 8px;
}

.foot-hint {
  flex: 1;
  min-width: 0;
  text-align: left;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--ink-3);
}
</style>
