<template>
  <div class="empty-state" :class="{ compact }">
    <div class="es-art">
      <el-icon><component :is="icon" /></el-icon>
    </div>
    <p class="es-title">{{ title }}</p>
    <p v-if="hint" class="es-hint">{{ hint }}</p>
    <div v-if="$slots.default" class="es-actions">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Component } from 'vue'
import { Document } from '@element-plus/icons-vue'

withDefaults(
  defineProps<{
    title: string
    hint?: string
    icon?: Component
    compact?: boolean
  }>(),
  { icon: () => Document, hint: '', compact: false }
)
</script>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 48px 24px;
  text-align: center;
  height: 100%;
  min-height: 220px;
}

.empty-state.compact {
  padding: 20px 16px;
  min-height: 118px;
  gap: 2px;
}

.empty-state.compact .es-art {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  font-size: 18px;
  margin-bottom: 4px;
}

.es-art {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  margin-bottom: 8px;
  border-radius: 16px;
  border: 1px dashed var(--line-strong);
  background: var(--fill-subtle);
  color: var(--ink-3);
  font-size: 22px;
}

.es-title {
  margin: 0;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--ink-2);
}

.es-hint {
  margin: 0;
  max-width: 360px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--ink-3);
}

.es-actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
}
</style>
