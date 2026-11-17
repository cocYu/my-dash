// 文章大纲：从 Markdown 源码提取 H1–H6 标题（跳过代码围栏内的 # 行），供左侧大纲面板与跳转定位。
export interface OutlineItem {
  /** 标题级别 1–6 */
  level: number
  /** 标题文本 */
  text: string
  /** 源码行号（0 起） */
  line: number
  /** 在全部标题中的序号（与预览渲染出的标题元素顺序一致，用于滚动定位） */
  index: number
}

export function extractOutline(source: string): OutlineItem[] {
  const lines = (source ?? '').split('\n')
  const items: OutlineItem[] = []
  let inFence = false
  let fenceMark = ''
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = line.match(/^\s*(`{3,}|~{3,})/)
    if (fence) {
      if (!inFence) {
        inFence = true
        fenceMark = fence[1][0]
      } else if (line.trim().startsWith(fenceMark)) {
        inFence = false
      }
      continue
    }
    if (inFence) continue
    const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (m) items.push({ level: m[1].length, text: m[2].trim(), line: i, index: items.length })
  }
  return items
}
