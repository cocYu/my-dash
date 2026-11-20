# AtoZ 设计系统 · Atelier

面向长时间使用的桌面工作台：中性纸面材质、克制的强调色、清晰的层级。所有颜色/圆角/间距都由 token 下发，主题只是一组 token 的替换。

## 1. 视觉方向

| 维度 | 规则 |
| --- | --- |
| 材质 | 实色面板 + 1px 描边 + 极轻投影；不使用毛玻璃、极光光斑 |
| 层级 | 背景（bg-deep）< 面板（surface-1）< 浮层（overlay-glass）；靠明度差与描边区分，不靠重阴影 |
| 强调色 | 每套主题只有 1 个 accent，仅用于选中态、主按钮、关键数字 |
| 圆角 | 面板 12px、控件 8px、小标签 6px、胶囊 999px |
| 密度 | 8px 栅格；列表行 34–40px；页面内边距 20–24px |
| 动效 | 120–180ms，`cubic-bezier(.2,.8,.2,1)`；仅位移/透明度；尊重 `prefers-reduced-motion` |

## 2. Design tokens

定义在 `src/renderer/src/styles/main.css` 的 `html[data-theme='<id>']` 中。

```css
/* 表面 */
--surface-1 / --surface-2 / --surface-3 / --surface-sunken
/* 文字 */
--ink-1（主）/ --ink-2（次）/ --ink-3（弱）
/* 强调 */
--accent / --accent-strong / --accent-soft / --accent-border / --accent-contrast
/* 描边与填充 */
--line / --line-strong / --divider / --fill-subtle / --fill-hover
/* 阴影 */
--shadow-sm / --shadow-md / --shadow-lg
/* 语义 */
--success / --warning / --danger / --info
/* 几何与字体 */
--radius 12 / --radius-sm 8 / --radius-xs 6
--font-sans / --font-display / --font-mono
--sidebar-w 236 / --sidebar-w-collapsed 72
```

旧变量名（`--glass-*`、`--fill-*`）保留并映射到新 token，历史组件无需逐个改动。

### 主题

| id | 名称 | 模式 | 强调色 |
| --- | --- | --- | --- |
| `aurora-dark` | 墨夜 | 深 | 靛蓝 `#6e8bff` |
| `ember-dark` | 焦糖 | 深 | 沙金 `#e0a45e` |
| `morning-light` | 宣纸 | 浅 | 墨蓝 `#2e5a87` |
| `jade-light` | 青瓷 | 浅 | 竹青 `#3a6a4f` |

深/浅切换保留色系：墨夜 ↔ 宣纸、焦糖 ↔ 青瓷（`toggleThemeMode()`）。

## 3. 布局

```
┌──────────────┬──────────────────────────────────┐
│ 侧边栏 236px │ 内容区（各页面自管滚动与头部）    │
│ 品牌          │  page-head：标题 / 说明 / 操作    │
│ 命令入口 ⌘K   │  page：18px 间距的纵向流          │
│ 导航分组      │                                  │
│ …             │  Notes / Todos / Toolbox 为满高   │
│ 主题 / 设置   │  多栏（面板 + 16px 间距）         │
│ 收起          │                                  │
└──────────────┴──────────────────────────────────┘
```

- 侧栏可收起为 72px 图标栏，状态存 `localStorage`。
- 一级导航：工作区（仪表盘 / 笔记 / 待办）、工具与智能（工具箱 / AI 工作台）、扩展（插件页）。
- AI 工作台二级分类改为页面顶部 `el-segmented`，给对话区让出宽度。
- 待办采用主从布局：未选中时详情面板不渲染，列表占满剩余宽度。

## 4. 组件规则

- **面板**：`.glass`（兼容旧类名）或 `.panel`；头部 `.panel-head` 统一 12/16 内边距 + 底部分隔线。
- **按钮**：默认描边透明底；主按钮实心 accent + 反色文字；危险操作用 `danger plain`。
- **输入**：1px 内描边，聚焦时 `accent` 描边 + 3px 柔光。
- **列表行**：hover 用 `--fill-hover`；选中用 `accent-soft` + 左侧 3px 指示条（待办）。
- **空态**：`EmptyState`（虚线方框图标 + 标题 + 提示 + 操作），紧凑模式用于窄面板。
- **命令面板**：Ctrl/Cmd+K 唤起，支持 ↑↓ / Enter / Esc，搜索页面与操作（新建笔记/待办、切换主题）。

## 5. 交互与可访问性

- 全局 `:focus-visible` 2px accent 描边；鼠标点击不显示焦点框。
- 所有可点击元素有 hover 反馈；禁用态用 `--ink-3`。
- 语义色仅表达状态（成功/警告/危险/信息），不用于装饰。
- 正文对比度：浅色 `#1c1d1a` on `#fffefb` ≈ 15:1；深色 `#eceef2` on `#16181c` ≈ 13:1，满足 WCAG AA。
- 动画在 `prefers-reduced-motion: reduce` 下降级为 0.01ms。

## 6. 文件索引

| 文件 | 作用 |
| --- | --- |
| `styles/main.css` | token、Element Plus 映射、全局组件样式 |
| `theme/index.ts` | 主题元数据、切换与订阅 |
| `App.vue` | 侧栏外壳、命令面板、路由过渡 |
| `components/EmptyState.vue` | 统一空态 |
| `views/*.vue` | 各页面布局与局部样式 |
