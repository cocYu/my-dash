// Markdown 排版微调（Typora 式"元素样式"配置）：字号/行高/段距/页宽/字体，
// 以 CSS 覆盖在渲染主题之上、位于用户自定义 CSS 之下；localStorage 持久化。
export interface MdTypography {
  fontSize: number // 正文字号 px（标题按 em 随动）
  lineHeight: number // 正文行高
  paraSpacing: number // 段落间距 px
  fullWidth: boolean // true = 铺满容器；false = 居中限宽
  maxWidth: number // 页宽上限 px（fullWidth 时忽略）
  fontFamily: 'default' | 'sans' | 'serif' | 'mono'
}

export const DEFAULT_TYPOGRAPHY: MdTypography = {
  fontSize: 15,
  lineHeight: 1.75,
  paraSpacing: 11,
  fullWidth: true,
  maxWidth: 860,
  fontFamily: 'default'
}

export const FONT_OPTIONS: { value: MdTypography['fontFamily']; label: string }[] = [
  { value: 'default', label: '主题默认' },
  { value: 'sans', label: '无衬线' },
  { value: 'serif', label: '衬线（书卷）' },
  { value: 'mono', label: '等宽' }
]

const FONT_STACKS: Record<Exclude<MdTypography['fontFamily'], 'default'>, string> = {
  sans: "-apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif",
  serif: "Georgia, 'Times New Roman', 'Songti SC', SimSun, 'Noto Serif SC', serif",
  mono: "'JetBrains Mono', Consolas, 'Courier New', monospace"
}

const KEY = 'mydash:md-typography'
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

export function getTypography(): MdTypography {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<MdTypography>
    return {
      fontSize: clamp(Number(saved.fontSize) || DEFAULT_TYPOGRAPHY.fontSize, 12, 24),
      lineHeight: clamp(Number(saved.lineHeight) || DEFAULT_TYPOGRAPHY.lineHeight, 1.2, 3),
      paraSpacing: clamp(Number.isFinite(saved.paraSpacing) ? Number(saved.paraSpacing) : DEFAULT_TYPOGRAPHY.paraSpacing, 0, 32),
      fullWidth: saved.fullWidth ?? DEFAULT_TYPOGRAPHY.fullWidth,
      maxWidth: clamp(Number(saved.maxWidth) || DEFAULT_TYPOGRAPHY.maxWidth, 480, 1600),
      fontFamily: FONT_STACKS[saved.fontFamily as 'sans'] ? (saved.fontFamily as MdTypography['fontFamily']) : 'default'
    }
  } catch {
    return { ...DEFAULT_TYPOGRAPHY }
  }
}

export function setTypography(t: MdTypography): void {
  localStorage.setItem(KEY, JSON.stringify(t))
}

/** 生成覆盖样式（应用内注入与 HTML/PDF 导出共用同一份） */
export function typographyCss(t: MdTypography): string {
  const lines: string[] = [
    '.md-body {',
    `  font-size: ${t.fontSize}px;`,
    `  line-height: ${t.lineHeight};`
  ]
  if (t.fontFamily !== 'default') lines.push(`  font-family: ${FONT_STACKS[t.fontFamily]};`)
  if (!t.fullWidth) {
    lines.push(`  max-width: ${t.maxWidth}px;`, '  margin-left: auto;', '  margin-right: auto;')
  }
  lines.push('}')
  if (t.paraSpacing !== DEFAULT_TYPOGRAPHY.paraSpacing) {
    lines.push(`.md-body p { margin: ${t.paraSpacing}px 0; }`)
  }
  return lines.join('\n')
}
