import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/**
 * 观测容器内容宽度，用于窗口很窄时切换紧凑布局（表格 → 卡片列表）。
 * 用 ResizeObserver 而不是 window.innerWidth：侧边栏折叠、分栏变化都能感知。
 */
export function useContainerWidth(target: Ref<HTMLElement | null | undefined>): Ref<number> {
  const width = ref(0)
  let ro: ResizeObserver | null = null

  onMounted(() => {
    const el = target.value
    if (!el) return
    width.value = el.clientWidth
    ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) width.value = entry.contentRect.width
    })
    ro.observe(el)
  })

  onBeforeUnmount(() => ro?.disconnect())

  return width
}
