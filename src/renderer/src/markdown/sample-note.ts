// 内置示例笔记：覆盖全部受支持语法的完整示例，供切换渲染主题 / 排版微调时预览效果。
export const SAMPLE_NOTE_TITLE = 'Markdown 语法示例'

export const SAMPLE_NOTE_CONTENT = `# Markdown 语法示例

[[toc]]

> 这是一篇 **语法全览** 示例笔记：上方目录由 \`[[toc]]\` 自动生成，正文覆盖本应用支持的全部 Markdown 语法。切换右上角的「渲染主题」与「排版微调」，即可对比不同风格下的阅读效果。

## 文本格式

普通段落文本。支持 **粗体**、*斜体*、***粗斜体***、~~删除线~~、\`行内代码\`、[文字链接](https://markdown.com.cn)，以及自动链接：https://github.com

转义字符可以输出符号本身：\\*这不是斜体\\*、\\# 不是标题。

行内公式也常用于写作：质能方程 $E = mc^2$，欧拉公式 $e^{i\pi} + 1 = 0$。

## 标题层级

以下依次是三级、四级、五级、六级标题：

### 三级标题

#### 四级标题

##### 五级标题

###### 六级标题

## 引用

> 这是一段引用文字。
> 引用可以有多行。

> 嵌套引用：
>
> > 里层引用的内容。
> >
> > 返回外层。

## 列表

### 无序列表

- 第一项
- 第二项
  - 嵌套项 2.1
  - 嵌套项 2.2
    - 更深一层
- 第三项

### 有序列表

1. 准备素材
2. 撰写草稿
   1. 列出大纲
   2. 填充内容
3. 校对发布

### 任务列表

- [x] 树形文件夹管理
- [x] CodeMirror 编辑器
- [x] 三种视图模式
- [ ] 双向编辑器（规划中）
- [ ] 协同编辑（规划中）

## 代码块

JavaScript：

\`\`\`js
// 斐波那契数列：记忆化递归
const memo = new Map()
function fib(n) {
  if (n <= 1) return n
  if (memo.has(n)) return memo.get(n)
  const v = fib(n - 1) + fib(n - 2)
  memo.set(n, v)
  return v
}
console.log(fib(40)) // 102334155
\`\`\`

Python：

\`\`\`python
def quick_sort(arr):
    """快速排序"""
    if len(arr) <= 1:
        return arr
    pivot = arr[len(arr) // 2]
    left = [x for x in arr if x < pivot]
    mid = [x for x in arr if x == pivot]
    right = [x for x in arr if x > pivot]
    return quick_sort(left) + mid + quick_sort(right)

print(quick_sort([3, 6, 1, 8, 2, 9, 4]))
\`\`\`

CSS：

\`\`\`css
.md-body blockquote {
  border-left: 4px solid var(--md-accent);
  background: var(--md-quote-bg);
  border-radius: 4px;
}
\`\`\`

JSON：

\`\`\`json
{
  "app": "AtoZ",
  "version": "0.1.0",
  "features": ["notes", "plugins", "sync", "themes"],
  "editor": { "engine": "CodeMirror 6", "views": ["edit", "split", "preview"] }
}
\`\`\`

Shell：

\`\`\`bash
# 克隆并启动开发模式
git clone https://github.com/example/mydash.git
cd mydash && npm install
npm run dev
\`\`\`

## 表格

| 语法 | 用途 | 示例 | 支持 |
| ----- | :----: | ----- | ----: |
| \`**粗体**\` | 强调 | **重要内容** | ✅ |
| \`~~删除线~~\` | 标记过期 | ~~旧方案~~ | ✅ |
| \`$..$\` | 行内公式 | $a^2 + b^2 = c^2$ | ✅ |
| \`[[toc]]\` | 目录 | 见文首 | ✅ |

## 数学公式

行内：勾股定理 $a^2 + b^2 = c^2$。

块级公式（高斯积分）：

$$
\\int_{-\\infty}^{\\infty} e^{-x^2} \\, dx = \\sqrt{\\pi}
$$

矩阵：

$$
A = \\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}, \\quad
A^{-1} = \\frac{1}{ad - bc} \\begin{pmatrix} d & -b \\\\ -c & a \\end{pmatrix}
$$

## 分隔线

上文结束。

---

下一段开始。

## 结语

- 试试在工具栏切换 **渲染主题**（GitHub / 极简 / 书卷 / 暗夜）
- 打开 **排版微调** 调整字号、行高、段距与页宽
- 用「导出」把当前样式输出为 HTML / PDF

> 排版是阅读体验的一半。祝写作愉快 ✍️
`
