<template>
  <div class="quick-add">
    <div class="qa-row" :class="{ active: focused }">
      <el-icon class="qa-icon"><ClockIcon /></el-icon>
      <input
        ref="inputRef"
        v-model="text"
        class="qa-input"
        :placeholder="placeholder"
        @focus="focused = true"
        @blur="focused = false"
        @keydown.enter="onEnter"
        @keydown.esc="clear"
      />
      <span v-if="text" class="qa-clear" title="清空（Esc）" @click="clear"><el-icon><CloseIcon /></el-icon></span>
    </div>
    <!-- 解析预览：让用户在回车前确认将被创建的属性 -->
    <div v-if="parsed && (parsed.tags.length || parsed.categoryName || parsed.priority != null || parsed.dueAt)" class="qa-preview">
      <span class="qa-preview-label">将创建：</span>
      <span v-if="parsed.dueAt" class="qa-chip due">
        <el-icon><ClockIcon /></el-icon>{{ formatDue(parsed.dueAt) }}
      </span>
      <span v-if="parsed.priority != null" class="qa-chip p" :style="{ background: priorityMeta(parsed.priority).color }">
        P{{ parsed.priority }}
      </span>
      <span v-if="parsed.categoryName" class="qa-chip cat">{{ parsed.categoryName }}</span>
      <span v-for="tag in parsed.tags" :key="tag" class="qa-chip tag">#{{ tag }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Close as CloseIcon, Timer as ClockIcon } from '@element-plus/icons-vue'
import { createTodo, formatDue, priorityMeta } from '../../api/todo'
import { parseQuickAdd } from '../../utils/quick-add'

const props = defineProps<{
  /** 已知分类名（供 @ 分类解析匹配） */
  categoryNames: string[]
  /** 当前侧栏选中的分类（解析不出 @分类 时兜底） */
  defaultCategoryId: number | null
}>()

const emit = defineEmits<{ created: [] }>()

const text = ref('')
const focused = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)
const submitting = ref(false)

const placeholder = '快速添加：想到什么写什么，回车创建（#标签 @分类 !P1 明天下午3点 +3d）'

const parsed = computed(() => (text.value.trim() ? parseQuickAdd(text.value, props.categoryNames) : null))

function clear(): void {
  text.value = ''
}

/** 暴露给父组件：命令面板等入口聚焦输入框 */
function focus(): void {
  inputRef.value?.focus()
}
defineExpose({ focus })

async function onEnter(e: KeyboardEvent): Promise<void> {
  // 中文输入法组合中的 Enter 是选字，不是提交（WCAG/IME 惯例）
  if (e.isComposing || e.keyCode === 229 || e.repeat) return
  const parsedNow = parsed.value
  if (!parsedNow || !parsedNow.title) {
    if (text.value.trim()) ElMessage.warning('没有识别到标题')
    return
  }
  if (submitting.value) return
  submitting.value = true
  try {
    await createTodo({
      title: parsedNow.title,
      category_id: parsedNow.categoryName ? undefined : props.defaultCategoryId ?? undefined,
      priority: parsedNow.priority ?? undefined,
      due_at: parsedNow.dueAt ?? undefined,
      tags: parsedNow.tags.length ? parsedNow.tags : undefined
    })
    clear()
    emit('created')
    ElMessage.success('已创建')
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.quick-add {
  flex-shrink: 0;
}

.qa-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border: 1px solid var(--divider);
  border-radius: var(--radius-sm);
  background: var(--fill-subtle);
  transition: border-color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
}

.qa-row.active {
  border-color: var(--accent-border);
  background: transparent;
}

.qa-icon {
  flex-shrink: 0;
  color: var(--ink-3);
}

.qa-row.active .qa-icon {
  color: var(--accent);
}

.qa-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  outline: none;
  font-size: 13px;
  color: var(--ink-1);
}

.qa-input::placeholder {
  color: var(--ink-3);
}

.qa-clear {
  flex-shrink: 0;
  cursor: pointer;
  color: var(--ink-3);
  display: inline-flex;
  padding: 2px;
  border-radius: 4px;
}

.qa-clear:hover {
  color: var(--ink-1);
  background: var(--fill-hover);
}

.qa-preview {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 2px 0;
}

.qa-preview-label {
  font-size: 11.5px;
  color: var(--ink-3);
}

.qa-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  white-space: nowrap;
}

.qa-chip.due {
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.qa-chip.p {
  color: #fff;
  font-weight: 700;
}

.qa-chip.cat {
  background: var(--fill-subtle);
  border: 1px solid var(--divider);
  color: var(--ink-2);
}

.qa-chip.tag {
  background: var(--fill-subtle);
  border: 1px solid var(--divider);
  color: var(--ink-2);
}
</style>
