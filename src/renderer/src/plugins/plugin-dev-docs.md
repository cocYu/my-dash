# AtoZ 插件开发文档

> AtoZ 插件 = 一个目录 + 一份清单 + 一个 ESM 入口。插件运行在渲染层主世界，可以把「页面 / 仪表盘小组件 / 工具箱工具」注册进主应用，并获得命名空间 KV 存储、受限业务 HTTP 与事件总线。

---

## 目录

[[toc]]

## 插件能做什么

| 能力 | API | 说明 |
| --- | --- | --- |
| 注册页面 | `ctx.registerPage()` | 新增一个路由页面，侧边栏自动出现入口（路径前缀 `/p/<插件id>`） |
| 注册仪表盘小组件 | `ctx.registerWidget()` | 在「仪表盘」页追加一张卡片 |
| 注册工具箱工具 | `ctx.registerTool()` | 与内置工具同一契约，出现在「工具箱」页 |
| 持久化存储 | `ctx.storage` | 插件命名空间 KV（JSON 落盘，随数据同步一起备份） |
| 读业务数据 | `ctx.http` | 走后端 REST（带鉴权），按 `permissions` 白名单放行 |
| 事件总线 | `ctx.events` | 插件与主应用/其他插件之间的轻量事件（`on` / `emit`） |
| 日志 | `ctx.log()` | 输出到 DevTools Console，自动带 `[plugin:<id>]` 前缀 |

## 快速开始

### 1. 目录结构

```
hello-tool/
├── plugin.json    # 插件清单
└── index.js       # ESM 入口（main 字段指定）
```

开发期把插件目录放到仓库的 **`plugins-dev/`** 下（主进程会额外扫描该目录，同 id 时仓库版本优先），重启或「重载全部」即可加载。

### 2. 编写清单 plugin.json

```json
{
  "id": "hello-tool",
  "name": "Hello 工具示例",
  "version": "0.1.0",
  "description": "演示 ctx.registerTool",
  "main": "index.js",
  "permissions": ["storage"]
}
```

字段说明：

| 字段 | 必填 | 约束 |
| --- | --- | --- |
| `id` | ✅ | `/^[a-z0-9][a-z0-9-]{1,63}$/`：小写字母/数字/连字符，2~64 位，全局唯一（决定路由前缀、KV 文件名与升级时的覆盖依据） |
| `name` | ✅ | 显示名称 |
| `version` | ✅ | 语义化版本字符串 |
| `main` | ✅ | ESM 入口文件（相对插件目录），文件必须存在，否则插件标记为「异常」 |
| `description` | – | 一句话描述，管理页展示 |
| `permissions` | – | 权限声明数组，见「权限模型」 |
| `icon` | – | 预留 |

### 3. 编写入口 index.js

入口只需导出一个 `activate(ctx)` 函数（可 async）。应用启动或「重载全部」时对每个启用的插件调用一次：

```js
// 工具箱插件示例：ctx.registerTool 把任意组件注册进「工具箱」
export function activate(ctx) {
  const { h, ref, onMounted, defineComponent } = ctx.vue
  const { ElButton, ElTag } = ctx.ui

  ctx.registerTool({
    id: 'hello',
    name: 'Hello 示例',
    category: '示例',
    description: '插件注册工具的最小示例（含 KV 持久化）',
    component: defineComponent({
      setup() {
        const count = ref(0)

        onMounted(async () => {
          const v = await ctx.storage.get('count')
          if (typeof v === 'number') count.value = v
        })

        async function bump() {
          count.value += 1
          await ctx.storage.set('count', count.value)
          ctx.log('计数已持久化:', count.value)
        }

        return () =>
          h('div', { style: 'display:flex;flex-direction:column;gap:14px' }, [
            h(ElTag, { effect: 'plain' }, () => `计数（KV 持久化）：${count.value}`),
            h(ElButton, { type: 'primary', onClick: bump }, () => '点我 +1')
          ])
      }
    })
  })

  ctx.log('hello-tool 已注册工具箱工具')
}
```

> **重要**：Vue API 一律从 `ctx.vue` 取，Element Plus 组件一律从 `ctx.ui` 取。**不要**在插件里裸 `import 'vue'` / `import 'element-plus'`——主应用打包后不存在可解析的裸模块，运行时会直接报错。

### 4. 加载与调试

- **开发**：插件目录放 `plugins-dev/` → 设置 → 插件 → 「重载全部」；`ctx.log` 输出在渲染层 DevTools Console
- **安装（zip）**：把插件目录压成 zip（`plugin.json` 在压缩包根目录，或唯一的一级子目录里）→ 「导入插件 (.zip)」
- **安装（URL）**：托管一个 zip 下载地址 → 「从 URL 安装…」，同 id 已安装时执行**覆盖升级**

完整两段式示例见仓库 `plugins-dev/hello-tool`（工具箱工具 + KV）与 `plugins-dev/notes-stats`（页面 + 仪表盘小组件 + HTTP 读数据）。

## PluginContext API

### ctx.meta

```ts
{ id: string, name: string, version: string, permissions: string[] }
```

### ctx.vue — Vue 能力集

已随主应用打包的 Vue API，按需解构使用：

```
h, ref, reactive, shallowRef, computed, watch, watchEffect, toRefs,
defineComponent, onMounted, onUnmounted, onBeforeUnmount,
onActivated, onDeactivated, nextTick, resolveComponent
```

### ctx.ui — Element Plus 组件集

渲染函数里直接作为标签对象使用（已按主应用主题打包）：

```
ElAlert, ElButton, ElCard, ElCheckbox, ElCheckboxGroup, ElCollapse, ElCollapseItem,
ElDatePicker, ElDivider, ElDropdown, ElDropdownItem, ElDropdownMenu, ElEmpty,
ElForm, ElFormItem, ElInput, ElInputNumber, ElRadio, ElRadioButton, ElRadioGroup,
ElSelect, ElOption, ElSlider, ElStatistic, ElSwitch, ElTabPane, ElTabs,
ElTable, ElTableColumn, ElTag, ElTooltip, message(ElMessage)
```

### ctx.registerPage(page)

```js
ctx.registerPage({
  path: '/stats',          // 最终路由：/p/<插件id>/stats
  title: '笔记统计',        // 侧边栏入口文字
  icon: SomeComponent,     // 可选，侧边栏图标（渲染函数组件）
  component: defineComponent({ /* … */ })
})
```

- 路由名自动生成并防重复：同插件重复注册同一 `path` 会抛错 `页面路径重复`
- 重载全部时插件路由自动清理重建

### ctx.registerWidget(widget)

```js
ctx.registerWidget({
  id: 'total',             // 实际 id 会加前缀：<插件id>:total
  title: '笔记总数',
  component: defineComponent({ /* 卡片内容 */ })
})
```

### ctx.registerTool(tool)

```js
ctx.registerTool({
  id: 'hello',             // 实际 id：<插件id>:hello
  name: 'Hello 示例',
  icon: SomeComponent,     // 可选
  category: '示例',         // 可选，默认「其他」；工具箱按分类分组
  description: '…',        // 可选
  component: defineComponent({ /* … */ })
})
```

与内置工具完全同契约：出现在「工具箱」页，可被搜索/分类。重复注册同一 id 会抛错 `工具重复注册`。

### ctx.storage — 插件命名空间 KV

```ts
storage: {
  get<T = unknown>(key: string): Promise<T | null>
  set(key: string, value: unknown): Promise<boolean>   // value 支持任意可 JSON 序列化值
  remove(key: string): Promise<boolean>
  keys(): Promise<string[]>
}
```

- 每个插件一个 JSON 文件：`userData/plugins/data/<插件id>.json`（原子写入，带内存缓存）
- **随「数据同步」一起备份/还原**（插件目录与 KV 都在备份包内）
- 卸载插件时其 KV 一并删除

### ctx.http — 受限业务 HTTP

```ts
http: {
  get<T = unknown>(url: string): Promise<T>
  post<T = unknown>(url: string, data?: unknown): Promise<T>
}
```

- 走主应用后端 REST（自动携带鉴权 token），响应为后端 `{ code, message, data }` 解包后的 `data`
- **必须先在 `plugin.json` 的 `permissions` 里声明**，运行时按「方法 + URL 前缀」校验，未声明直接抛错

当前开放的业务权限：

| 权限 | 放行 |
| --- | --- |
| `notes:read` | `GET /api/notes` |

需要新的数据权限（如待办、分类）时，在主应用 `src/renderer/src/plugins/host.ts` 的 `PERMISSION_RULES` 中扩表。

### ctx.events — 事件总线

```ts
events: {
  on(name: string, cb: (payload?: unknown) => void): () => void  // 返回解绑函数
  emit(name: string, payload?: unknown): void
}
```

应用内全局总线，适合插件之间或与主应用的松耦合联动。事件名建议带插件前缀（如 `hello-tool:tick`）避免冲突。

### ctx.log(...args)

等价 `console.log`，输出自动带 `[plugin:<id>]` 前缀，调试时在 DevTools Console 过滤该前缀即可。

## 权限模型

`permissions` 是**声明式约束**：`ctx.http` 在每次调用时校验白名单，未声明即抛错；`storage` / 事件等本插件命名空间内的能力不做强制校验（声明它们主要是为了向用户说明插件行为）。

```json
{ "permissions": ["notes:read", "storage"] }
```

需要注意：插件运行在渲染层主世界（与主应用同一 JS 上下文），permissions 不是硬安全边界。**只安装可信来源的插件**；分发不可信插件时，主应用的 API 形态已按「未来收敛到 iframe 沙箱」的方向设计。

## 打包与分发

### zip 包要求

- `plugin.json` 位于压缩包**根目录**，或**唯一的一级子目录**内（两种布局都支持）
- 入口 `main` 与其相对路径依赖必须完整包含（插件以普通 ESM 文件经 `plugin://` 协议加载，支持多文件与相对 import，静态资源 `.js/.json/.css/.html/.png/.svg/...` 均可携带）
- zip 路径做了防穿越校验（zip slip），异常路径会被拒绝

### 远程安装 / 升级

「从 URL 安装…」下载 zip 后**覆盖安装**（同 id 即升级，启停状态与安装时间保留）。可选 sha256 校验。

### 发布到工具仓库（registry）

仓库内置索引地址 `tools-registry/registry.json`（Gitee 仓库内维护），条目格式：

```json
[
  {
    "id": "hello-tool",
    "name": "Hello 工具示例",
    "version": "0.2.0",
    "description": "…",
    "category": "示例",
    "downloadUrl": "https://…/hello-tool-0.2.0.zip",
    "sha256": "<zip 的 sha256，可选但强烈建议>"
  }
]
```

- 用户在「工具箱 → 远程安装」里拉取该索引一键安装；索引支持在界面里填自定义 URL 覆盖
- 生成 sha256：`certutil -hashfile hello-tool-0.2.0.zip SHA256`（Windows）或 `shasum -a 256 <file>`（macOS/Linux）
- 索引与包版本不一致时（升级后），更新 registry 里的 `version` / `downloadUrl` / `sha256` 即可

## 生命周期与重载

```
应用启动 ──► 扫描 userData/plugins 与 plugins-dev ──► 逐个加载启用插件 ──► activate(ctx)
管理页「重载全部」 ──► 清空插件路由/注册表/工具 ──► 换缓存参数重新 import ──► activate(ctx)
```

- 单个插件加载失败**互相隔离**：管理页顶部红色 alert 显示错误，其余插件正常
- 清单校验失败（缺字段/id 非法/入口不存在）→ 表格中该插件标记「异常」，悬浮可见原因
- 「禁用」只影响加载与否，目录与 KV 数据保留

## 设计边界与注意事项

1. **禁止裸 import `vue` / `element-plus`**（打包后无裸模块）；一切从 `ctx.vue` / `ctx.ui` 取
2. 插件运行在主世界：不要污染全局对象（`window`/`document` 上的自定义属性请带插件前缀）
3. 组件内避免直接操作主应用路由/存储；需要业务数据走 `ctx.http`（声明权限）
4. KV 值必须可 JSON 序列化；大文件请放插件目录自身（注意同步体积）
5. `plugin.json` 与入口在安装时严格校验，改清单字段需走「升级」流程（同 id 覆盖安装）
6. 打包后的应用不包含 `plugins-dev`（那是仓库开发目录），正式插件一律走安装

## FAQ

**Q：`import { ref } from 'vue'` 报错解析失败？**
A：按设计如此。用 `const { ref } = ctx.vue`。

**Q：注册页面后侧边栏没出现入口？**
A：确认 `activate` 无异常（管理页无红色 alert），并尝试「重载全部」；路径必须以 `/` 开头或自动补全。

**Q：ctx.http 报「未声明访问权限」？**
A：在 `plugin.json` 的 `permissions` 加对应权限（如 `notes:read`），保存后重载插件。当前白名单只开放了笔记读取，更多数据权限需主应用扩表。

**Q：同 id 导入 zip 提示已存在？**
A：本地导入不做覆盖，先卸载再导入；或改用「从 URL 安装」走覆盖升级。

**Q：插件数据在哪、会被同步吗？**
A：目录在 `userData/plugins/`，KV 在 `userData/plugins/data/<id>.json`；两者都在数据同步的备份包内，换设备还原后自动回来（还原后主应用会自动重扫插件）。
