# AtoZ

Electron + Go + SQLite 桌面应用骨架：Vue 3 界面层、Go 子进程后端、SQLite 存储，
electron-builder 打 Windows NSIS 安装包。当前内置示例模块「笔记管理」演示完整链路。

## 架构

```
┌────────────────────────── Electron ──────────────────────────┐
│  renderer (Vue3 + Element Plus)                              │
│      │  window.api.getBackendConfig()  ← preload (IPC)       │
│      │  axios + X-API-Token                                  │
│      ▼                                                       │
│  http://127.0.0.1:<随机端口>  ──CORS──►  Go 后端子进程         │
│  主进程: 挑空闲端口/生成token/spawn后端/健康检查/退出清理       │      │ Gin + modernc.org/sqlite (纯Go)               │
│      │ SQLite WAL ← %APPDATA%/mydash/mydash.db        │
└──────────────────────────────────────────────────────────────┘
```

- **端口**：主进程用 `net` 模块挑空闲端口，经 `-port` 参数传给 Go；Go 就绪后向 stdout 打印 `READY port=<n>`。
- **鉴权**：主进程每次启动生成 32 字节随机 token，经 `-token` 传给 Go、经 IPC 给渲染层；Go 中间件校验 `X-API-Token`，防止本机其他进程未授权访问。
- **防孤儿**：后端 stdin 与父进程相连，EOF（父进程退出）即自动退出；Electron 侧 `will-quit` 也会主动 kill。
- **数据库**：`app.getPath('userData')/mydash.db`，WAL 模式 + busy_timeout；迁移用 `PRAGMA user_version`（见 `backend/internal/db/db.go`）。

## 目录

```
backend/                  Go 模块（独立 go.mod）
  main.go                 入口：-port -db -token 参数、READY 行、优雅退出、stdin 防孤儿看门狗
  internal/db/            SQLite 打开与迁移
  internal/server/        Gin 装配：CORS、Token 中间件、路由
  internal/api/           业务接口（示例：notes CRUD）
scripts/
  build-backend.mjs       go build 编排（dev / release）
  gen-icons.mjs           占位图标生成（PNG/ICO/ICNS 手写编码，零依赖）
  e2e-check.mjs           CDP 连窗口的 CRUD 冒烟测试（需 dev + MYDASH_DEBUG_PORT=9222）
  e2e-menu.mjs            菜单快捷键与关窗行为验证
  e2e-seed.mjs            通过 UI 预置一条笔记（重启持久化验证用）
src/
  main/                   Electron 主进程（子进程管理、窗口、IPC、菜单、托盘）
    menu.ts               应用菜单（macOS 完整 roles / Win+Linux 精简隐藏）
    tray.ts               托盘（图标、菜单、点击行为、开机自启）
  preload/                contextBridge 暴露 getBackendConfig() / onQuickCreate()
  renderer/               Vue 应用（布局、路由、axios 封装、视图）
resources/icons/          托盘图标（运行时资源，打包进 extraResources）
build/                    应用图标（electron-builder 读取；icon.ico/icns/512.png）
```

## 菜单与托盘

- **应用菜单**：macOS 菜单栏常驻（appMenu/editMenu/viewMenu/windowMenu roles，保证 Cmd+C/V、Cmd+Q 可用）；
  Windows/Linux 精简菜单（文件/编辑/视图/帮助）默认隐藏，按 `Alt` 唤出。
- **托盘**：显示/隐藏主窗口（左键单击 toggle，仅 Windows）、新建笔记（经 `notes:quick-create` IPC 直接新建根级笔记并选中）、开机自启（checkbox，`app.setLoginItemSettings`）、
  关于、退出。图标按平台自动选择（见下表）。
- **关窗行为**：点 X 隐藏到托盘；真正退出走托盘/菜单"退出"或 macOS `Cmd+Q`（`before-quit` 置
  `isQuitting` 后放行 close）。

## 平台差异矩阵

| 事项 | Windows | macOS | Linux |
|------|---------|-------|-------|
| 应用菜单 | 窗口内隐藏，Alt 唤出 | 屏幕顶部常驻（系统强制） | 窗口内隐藏，Alt 唤出 |
| 点 X | 隐藏到托盘 | 隐藏到托盘（同惯例） | 隐藏到托盘 |
| 真退出 | 托盘/菜单退出、Ctrl+Q | Cmd+Q、托盘退出 | 托盘/菜单退出 |
| 托盘图标 | `tray.ico`（16/24/32） | `trayTemplate.png`+`@2x`（黑+alpha，自动适配深浅色） | `tray.png`（22px） |
| 托盘左键 | toggle 窗口 | 弹菜单（菜单栏惯例） | **不投递 click**（AppIndicator 限制），仅右键菜单 |
| 开机自启 | 注册表 Run 键 | LaunchAgents | `~/.config/autostart` |
| 环境注意 | — | dock 常驻 | GNOME 需装 AppIndicator 扩展（`gnome-shell-extension-appindicator`），KDE/Ubuntu 原生 |
| 数据目录 | `%APPDATA%\mydash` | `~/Library/Application Support/mydash` | `~/.config/mydash` |

> 应用显示名为 **AtoZ**，数据目录沿用旧名 `mydash`（主进程显式固定 `userData`）。
> 这样从 myDash 升级后，笔记、附件、AI 配置与云同步设置无需迁移即可继续使用。

> macOS / Linux 打包配置已启用（`electron-builder.yml`），但尚未在对应系统实测；
> 发行流水线见下方「发行构建」。

## 常用命令

```bash
npm run dev          # 编译 dev 后端 + 启动应用（热更新）
npm run typecheck    # vue-tsc + tsc 类型检查
npm run build        # 等同 build:win：release 后端 + 前端构建 + NSIS 安装包 → dist/
npm run build:win    # Windows 安装包
npm run build:mac    # macOS dmg + zip（需在 macOS 上执行）
npm run build:linux  # Linux AppImage + deb
npm run build:dir    # 只出免安装目录，快速验证打包产物
npm run release:tag -- 0.2.0   # 打发行 tag 并推 Gitee + GitHub，触发三端构建
node scripts/e2e-check.mjs   # 先 MYDASH_DEBUG_PORT=9222 npm run dev 再执行
```

## 发行构建（GitHub Actions → GitHub + Gitee Release）

推送 `release/vX.Y.Z` tag 后，由 GitHub Actions 的三台构建机并行产出
Windows / macOS / Linux 安装包，同时发布到 GitHub 与 Gitee 的「发行版」页面，
随后清理 Actions 产物：

```bash
npm run release:tag -- 0.2.0
```

之所以用 GitHub Actions 而不是 Gitee Go：Gitee Go 云端只有 Linux 容器（Node 插件最高 15.x），
macOS 无法云端构建，而「主机管理」是付费能力，个人免费版没有。

一次性准备（GitHub 仓库 + `GITEE_TOKEN` Secret）、产物命名、100MB 分卷规则见
[`docs/ci-release.md`](docs/ci-release.md)。

## 新增一个业务模块（三步）

1. **数据库**：`backend/internal/db/db.go` 迁移里加建表语句，`user_version` 升到 2。
2. **接口**：仿照 `backend/internal/api/notes.go` 写 handler，在 `internal/server/server.go` 注册路由。
3. **界面**：仿照 `src/renderer/src/views/NotesView.vue` + `src/api/notes.ts` 写视图与 API 封装，
   在 `src/renderer/src/router/index.ts` 加路由、`App.vue` 菜单加入口。

## 插件系统

插件 = 一个目录（`plugin.json` 清单 + ESM 入口），加载进渲染层主世界，通过 `activate(ctx)` 注册能力。

**开发文档**：应用内「设置 → 插件 → 插件开发文档」可查阅完整开发指南（清单字段、PluginContext API、权限模型、打包分发、FAQ），文档源文件为 `src/renderer/src/plugins/plugin-dev-docs.md`。

### 安装方式
- **插件中心**：工具箱 →「获取工具」，从 [AtoZPlugins](https://gitee.com/yukai1998/AtoZPlugins) 的远程索引一键安装/升级（主源 + 镜像自动回退，sha256 校验）
- **zip 导入**：插件管理页 →「导入插件 (.zip)」（支持根目录或单层子目录打包）
- **目录放置**：正式插件放 `%APPDATA%/mydash/plugins/<id>/`；开发中的插件放仓库 `plugins-dev/<id>/`（仅 dev 模式扫描，dev 同名插件优先于已安装版本）

### 插件中心（独立仓库 AtoZPlugins）

插件源码、打包与发行都在 [AtoZPlugins](https://gitee.com/yukai1998/AtoZPlugins)（本机 `E:/project/electorn/AtoZPlugins`），
与本仓库解耦，可独立发版：

```bash
cd E:/project/electorn/AtoZPlugins
npm run check                                  # 校验清单与入口
git tag -a v0.1.0 -m "插件中心 0.1.0" && git push origin v0.1.0 && git push github v0.1.0
```

推送 `vX.Y.Z` 后由其 CI 打包 → 发 GitHub Release → 回写 `registry.json` → 镜像 Gitee。
本仓库的 `plugins-dev/` 只是开发沙箱（内容已 gitignore），官方插件不放这里。

应用侧索引按 Gitee raw → jsDelivr → GitHub raw 回退，下载按 `downloadUrl` → `mirrors` 回退。
完整流程与安全边界见 [`docs/plugin-registry.md`](docs/plugin-registry.md)。

### 插件清单 plugin.json
```json
{
  "id": "notes-stats",
  "name": "笔记统计",
  "version": "0.1.0",
  "description": "…",
  "main": "index.js",
  "permissions": ["notes:read", "storage"]
}
```

### PluginContext API
| API | 说明 |
|-----|------|
| `ctx.registerPage({ path, title, icon?, component })` | 注册页面：路由自动挂 `/p/<插件id>` 前缀，侧边栏自动出现入口 |
| `ctx.registerWidget({ id, title, component })` | 注册仪表盘小组件卡片 |
| `ctx.registerTool({ id, name, icon?, category?, description?, component })` | 注册工具箱工具：与内置工具混排（见 [AtoZPlugins/plugins/hello-tool](https://gitee.com/yukai1998/AtoZPlugins/tree/main/plugins/hello-tool)） |
| `ctx.http.get/post(url, data?)` | 受权限白名单约束的业务 API 调用（如 `notes:read` → `GET /api/notes*`） |
| `ctx.storage.get/set/remove/keys` | 插件命名空间 KV（主进程按 id 落 JSON，重启保留） |
| `ctx.vue` | Vue 常用 API（h/ref/computed/defineComponent/onMounted…，勿裸 import 'vue'） |
| `ctx.ui` | Element Plus 常用组件（ElCard/ElTable/…，勿裸 import 'element-plus'） |
| `ctx.events.on/emit` | 应用级事件总线 |
| `ctx.log` | 带 `[plugin:<id>]` 前缀的日志 |

完整示例见 [AtoZPlugins/plugins/notes-stats](https://gitee.com/yukai1998/AtoZPlugins/tree/main/plugins/notes-stats)（页面 + 小组件 + 业务数据 + KV 全覆盖）。

### 设计边界
- 主世界模型下插件可互访数据与页面 API，`permissions` 是**声明式约束而非硬安全边界**；未来分发不可信插件时演进为 iframe 沙箱（API 形态已按该方向收敛）
- 代码经 `plugin://` 自定义协议从插件目录加载（asar 之外），插件代码不参与主应用构建
- 托盘/快捷键扩展点留作二期

## 主题

「设置 → 外观」中可切换 4 套预设主题（选择持久化到 localStorage，启动恢复）：

| 主题 | 模式 | 说明 |
|------|------|------|
| 暮色极光 | 深色 | 默认。墨蓝底 + 青绿/靛蓝/品红极光 + 冰青主色 |
| 熔金暮色 | 深色 | 暖棕底 + 橙/玫瑰/金极光 + 琥珀主色 |
| 晨雾 | 浅色 | 雾蓝白底 + 天蓝/丁香/蜜橙光斑 + 深海蓝主色 |
| 竹青 | 浅色 | 淡青白底 + 翠绿/青/嫩黄光斑 + 松绿主色 |

新增主题：在 `styles/main.css` 加一段 `html[data-theme='<id>'] { … }` token 集合，
再在 `theme/index.ts` 的 `THEMES` 里登记（id/name/mode/预览色）即可，深色主题会自动挂
Element Plus 的 `html.dark` 基底。插件页面经 Element Plus 变量自动继承主题。

## 工具箱

「工具箱」页：左侧搜索 + 分类工具列表，右侧工具工作区（`/toolbox/:toolId` 可深链直达）。

- **内置 11 个工具**：JSON 美化（格式化/压缩/校验）、JSON 比较（键序规范化后 diff）、文本比较
  （CodeMirror merge 双栏）、正则测试（实时高亮 + 分组提取）、Postman（经本机后端代理转发，带
  SSRF 防护）、WebSocket 测试、时间戳转换、Cron 表达式（cron-parser）、URL/Base64 编解码、
  哈希计算（MD5/SHA-1/SHA-256，文本与文件）、UUID 生成
- **JSON 宽松输入**：JSON 美化 / JSON 比较自动识别三种非严格输入——**JSON5**（无引号键/单引号/
  尾逗号/注释）、**JS 对象字面量**（`undefined` 值自动转 `null`）、**转义 JSON 文本**（日志里拷出的
  `{\"a\":1}`，含多重转义自动逐层还原，带外层引号亦可），校验标签显示识别结果；输出一律为严格 JSON
- **性能设计**：工具组件全部 `defineAsyncComponent` 懒加载（未打开零执行）；工作区 `keep-alive
  :max=6` LRU 缓存（内存有界，回访秒开）；实时解析类 300ms 防抖；WebSocket 切走自动断开
- **Postman 网络通道**：渲染层受 CORS 限制，任意域请求统一走 Go 后端 `POST /api/tools/proxy`
  转发（默认 15s 超时、响应 10MB 上限、拒绝本机/内网目标防 SSRF）
- **插件工具**：插件经 `ctx.registerTool({ id, name, icon?, category?, description?, component })`
  注册工具，与内置工具混排展示（完整示例见 [AtoZPlugins/plugins/hello-tool](https://gitee.com/yukai1998/AtoZPlugins/tree/main/plugins/hello-tool)）。插件可见的 Vue API 与
  Element Plus 组件白名单已扩充（ElTabs/ElSelect/ElForm/ElDatePicker 等）

### 远程安装工具

「工具箱 → 获取工具」或「设置 → 插件 → 从 URL 安装」：

- **registry 索引**（`AtoZPlugins/registry.json`，内置三源回退，也可在界面填自定义地址）：

```json
[
  {
    "id": "hello-tool",
    "name": "Hello 工具示例",
    "version": "0.1.0",
    "description": "…",
    "downloadUrl": "https://gitee.com/…/hello-tool-0.1.0.zip",
    "mirrors": ["https://github.com/…/hello-tool-0.1.0.zip"],
    "sha256": "64 位十六进制（必填，安装时强校验）",
    "size": 1294
  }
]
```

- **安装流程**：下载 zip（≤20MB，主源失败自动切镜像）→ sha256 校验 → 原子覆盖落位（同 id 即升级，
  保留启停状态）→ 重载插件 → 工具自动出现在工具箱
- **安全边界**：沿用插件系统既有声明（主世界运行、权限为声明式约束），请仅安装可信来源的包

## 待办

「待办」页：左侧分类与标签筛选，中间筛选列表，右侧详情面板。

- **分类**：待办可归属分类，也可留在根目录；删除分类时其待办自动回到根目录
- **标签**：多标签（可输入新建），侧栏标签云点击即筛选；无人引用的标签自动回收
- **优先级**：P0（紧急）- P6（极低）七级彩色徽标
- **时间**：开始时间 / 截止时间（日期时间选择）
- **子任务**：待办可拆分子任务（一级，自动统计完成进度 x/y，列表内展开勾选）
- **描述**：富文本编辑器（加粗/斜体/下划线/删除线/有序无序列表/链接/清除格式），入库前白名单消毒
- **评论**：每条待办可追加评论记录，可删除
- **筛选排序**：状态（待处理/已完成/已关闭/全部）+ 标题搜索 + 优先级 + 截止时间（今天/未来7天/已逾期/无截止）+ 标签；按截止时间/优先级/标题/创建时间排序
- **超时提示**：配置了截止时间的待办可单独设置提前量（1小时 ~ 7天）——进入提前期标记橙色「即将超时」，过点标记红色「已超时」
- **超时通知**：即将超时 / 已超时可推送到外部渠道（见下方「通知提醒」），列表徽标与应用内提示并存
- **右键菜单**：列表行右键 → 标记完成 / 删除（顶层删除会连同子任务与评论，带确认）
- **状态流转**：待处理 ↔ 已完成 / 已关闭，关闭后可随时重新开启

## 通知提醒

「设置 → 通知提醒」：待办即将超时 / 已超时时推送通知。

- **触发规则**：仅「待处理」且配置了截止时间与超时提醒的待办；进入提前期发「即将超时」、跨过截止点发「已超时」，各通知一次（待办改期后自动重新计时）
- **渠道**：系统通知（桌面弹窗，默认开启）、企业微信群机器人、飞书自定义机器人（可选加签）、钉钉自定义机器人（加签）、邮箱（SMTP 直发，支持多收件人）
- **聚合防轰炸**：每分钟检查一轮，同一轮到期的多条待办按渠道聚合为一条消息；单渠道发送失败自动重试，不影响其他渠道
- **限制**：仅在 AtoZ 运行期间检查（启动时补发错过的提醒），应用退出期间不推送
- **安全**：Webhook 地址、加签密钥、SMTP 授权码均经 Electron safeStorage 加密存储；每个渠道支持「发送测试」
- **联调辅助**：`MYDASH_NOTIFY_OUTBOX=1` 时所有渠道改为写入 `userData/notify/outbox.jsonl`（供自动化验证），`MYDASH_NOTIFY_NO_TIMER=1` 停用周期调度仅手动触发

## 数据同步

「设置 → 数据同步」：将 **SQLite 数据库快照 + 全部插件（目录/KV/启停状态）** 打包为 zip 上传云端。

- **支持目标**：WebDAV、S3 兼容对象存储（AWS/R2/OSS/MinIO，支持路径风格寻址）
- **同步记录**：最近 50 条（时间/触发方式/目标/大小/状态），支持从任意成功备份**一键还原**
- **云端备份列表**：直接列举远端实际存在的备份（与本地记录无关），换新设备配置同一目标后即可拉取列表并选择还原
- **定时同步**：固定间隔（每 N 小时）或每日定点（HH:mm），错过自动补跑
- **保留策略**：云端自动清理旧备份，仅保留最近 N 份（默认 10）
- **安全**：密码/密钥经 Electron safeStorage 加密存储

还原流程会短暂停止后端、替换数据库后原端口重启（页面数据自动回到备份时点）；备份外的已装插件保留不删。

## 笔记（Markdown）

「笔记」页：左侧文件夹树（拖拽移动/排序、右键与悬停操作、搜索），右侧 **CodeMirror 6** 编辑器 + 实时预览。

- **左侧面板**：「目录 / 大纲」分段切换（进入默认**目录**，切换在应用会话内记忆）。大纲为当前笔记的 H1–H6 标题树
  （自动跳过代码围栏与转义 `\#`），点击条目在源码行与预览标题间定位滚动
- **视图**：源码 / 分屏（分隔条可拖）/ 预览，三种模式随点随切（记忆上次选择）
- **分屏滚动同步**：源码与预览双向跟随（markdown-it 为顶层块标注源码行号作锚点，锚点间线性插值；
  rAF 节流 + 二分查找 + 程序滚动回声抑制，任一侧到到底自动吸附；5000+ 行文档实测滚动零长任务）
- **命名约束**：同级不允许出现同名文件夹 / 同名笔记（后端 409 强制，拖拽跨层移动同样校验）
- **导入 Markdown**：工具栏或文件夹右键「导入 Markdown…」，支持多选文件或整个文件夹（子目录 → 文件夹，
  `.md` → 笔记，重名自动追加序号）
- **示例笔记**：工具栏按钮一键创建语法全览笔记（TOC/标题层级/列表/任务/表格/代码高亮/公式/引用/转义全覆盖），
  用于对比渲染主题与排版效果
- **语法**：GFM（表格/删除线/自动链接）、任务列表、代码高亮（highlight.js）、KaTeX 公式（`$…$` / `$$…$$`）、`[[toc]]` 目录与标题锚点
- **渲染主题**：预设 GitHub / 极简 / 书卷 / 暗夜 四款
- **Typora 主题兼容**：工具栏「画笔」导入 Typora 的 `.css` 主题文件（`#write`/`body`/`html`/`:root`
  自动映射到预览容器 `.md-body`），主题下拉「Typora 主题」分组快速切换；导入的主题存放于
  `%APPDATA%/mydash/md-themes/`，支持管理/删除，导出 HTML/PDF 同样携带
- **排版微调**（Typora 式元素样式）：正文字号 / 行高 / 段落间距 / 正文宽度（铺满或居中限宽）/ 字体（无衬线、衬线、等宽），
  即时生效并持久化，HTML/PDF 导出同样携带
- **自定义 CSS**：以 `.md-body` 为根选择器，叠加在主题、Typora 主题与排版之上（localStorage 持久化）
- **状态栏**：编辑器底部展示字数统计（中文按字、英文按词）、预计阅读时间、创建时间与最近更新时间
- **版本**：保存时内容有变自动快照（每篇自动版本上限 50）+ 手动标签快照；抽屉内可预览/一键还原（还原前当前内容也会自动存版）
- **导出**：Markdown / HTML（内嵌当前主题、Typora 主题、排版与 KaTeX 样式）/ PDF（printToPDF，**内嵌 h1–h6 书签大纲**，WPS/Acrobat 左侧书签栏可直接导航）
- **图片附件**：编辑器内直接 **粘贴截图 / 拖拽图片 / 工具栏选图**，自动按内容寻址（sha1）存入
  `%APPDATA%/mydash/attachments/` 并插入 `attach://` 链接——同一张图多笔记复用只存一份，历史版本还原图片不丢；
  预览经 `attach://` 特权协议加载；导出 HTML/PDF 自动内嵌 base64（单文件离线可用）；数据同步备份包含全部附件；
  「设置 → 通用 → 图片附件」可查看用量、打开目录、清理未被任何笔记/版本引用的孤儿图片
- **自动保存**：停顿 800ms 或 Ctrl+S 保存（标题与内容均触发）；切换笔记前自动落盘

预览样式叠加顺序（后者覆盖前者）：渲染主题 → 排版微调 → Typora 主题 → 自定义 CSS。

插件可通过 `ctx.registerPage` 注册自己的页面与 `ctx.http`（`notes:read` 权限）读取笔记数据。

## 已知事项

- 应用图标暂用 Electron 默认；放 `build/icon.ico`（256x256 起）后重新 `npm run build` 即可。
- 未配置代码签名，首次运行 SmartScreen 可能提示，属正常。
- `MYDASH_DEBUG_PORT=<port> npm run dev` 会开启 CDP 远程调试，可用于 Playwright 自动化。
