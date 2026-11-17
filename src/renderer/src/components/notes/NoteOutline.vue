<template>
  <div class="note-outline">
    <div v-if="items.length === 0" class="outline-empty">
      <el-empty :description="emptyText" :image-size="72" />
    </div>
    <div v-else class="outline-list" @click="onClick">
      <div
        v-for="item in items"
        :key="item.index"
        class="outline-item"
        :data-index="item.index"
        :style="{ paddingLeft: 8 + (item.level - minLevel) * 14 + 'px' }"
        :title="item.text"
      >
        <span class="outline-tag" :data-level="item.level">H{{ item.level }}</span>
        <span class="outline-text">{{ item.text }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { OutlineItem } from '../../markdown/outline'

const props = defineProps<{
  items: OutlineItem[]
  hasNote: boolean
}>()

const emit = defineEmits<{
  jump: [item: OutlineItem]
}>()

const minLevel = computed(() => Math.min(6, ...props.items.map((i) => i.level)))
const emptyText = computed(() => (props.hasNote ? '这篇笔记还没有标题' : '选中笔记后显示大纲'))

function onClick(e: MouseEvent): void {
  const el = (e.target as HTMLElement).closest('.outline-item') as HTMLElement | null
  if (!el) return
  const index = Number(el.dataset.index)
  const item = props.items[index]
  if (item) emit('jump', item)
}
</script>

<style scoped>
.note-outline {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.outline-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.outline-list {
  flex: 1;
  overflow-y: auto;
  padding: 2px 0 8px;
}

.outline-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  margin: 1px 0;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  color: var(--ink-2);
  min-width: 0;
}

.outline-item:hover {
  background: var(--fill-hover);
  color: var(--ink-1);
}

.outline-tag {
  flex-shrink: 0;
  font-size: 10px;
  line-height: 1;
  padding: 3px 4px;
  border-radius: 4px;
  background: var(--fill-subtle);
  color: var(--ink-3);
  font-family: 'JetBrains Mono', Consolas, monospace;
}

.outline-item:hover .outline-tag {
  color: var(--accent-strong);
}

.outline-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
