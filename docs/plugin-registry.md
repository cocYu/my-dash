# 插件中心：用 GitHub / Gitee 分发插件

插件的源码、打包与发行都放在独立仓库 **`AtoZPlugins`**（本机 `E:\project\electorn\AtoZPlugins`），
主应用只负责读取索引与安装。这样插件可以独立发版，不必跟着应用走 release。

```
AtoZPlugins  ──tag vX.Y.Z──►  GitHub Actions  ──►  GitHub Release（zip）
                                    │                     │
                                    ├─ 回写 registry.json ─┤
                                    └─ 镜像 ─► Gitee Release（zip + registry）
                                                          │
AtoZ 应用 ── 拉 registry.json（Gitee raw → jsDelivr → GitHub raw）── 下载 zip（Gitee → GitHub）── 安装
```

## 一、插件中心仓库结构

```
AtoZPlugins/
├── plugins/                    # 一个子目录一个插件
│   ├── hello-tool/{plugin.json,index.js}
│   └── notes-stats/
├── scripts/
│   ├── build-tools.mjs         # 校验 + 打包 + 生成 registry.json
│   └── publish-gitee.mjs       # 镜像到 Gitee Release
├── .github/workflows/release.yml
├── registry.json               # 索引（CI 回写，勿手改）
└── dist/                       # 产物（gitignored）
```

## 二、加一个插件

1. 复制 `plugins/hello-tool` 为 `plugins/<id>`，改 `plugin.json`（`id` 发布后不要改）：

```json
{
  "id": "my-tool",
  "name": "我的工具",
  "version": "0.1.0",
  "description": "一句话说明",
  "category": "文本",
  "main": "index.js",
  "permissions": ["storage"]
}
```

2. 写 `index.js`，导出 `activate(ctx)`，用 `ctx.registerTool / registerPage / registerWidget` 注册能力。
   Vue 从 `ctx.vue` 取、Element Plus 从 `ctx.ui` 取，不要裸 import（打包后没有裸模块）。
3. 本地校验与打包：

```bash
cd E:/project/electorn/AtoZPlugins
npm install
npm run check     # 校验清单、入口、体积、符号链接
npm run pack      # 产物在 dist/
```

4. 本地调试：把插件目录放进主应用的 `plugins-dev/`（dev 模式扫描，内容已 gitignore），
   主应用「设置 → 插件 → 重载全部」。

## 三、发布

```bash
git tag -a v0.1.0 -m "插件中心 0.1.0"
git push origin v0.1.0      # Gitee
git push github v0.1.0      # GitHub（流水线跑在这里）
```

流水线（`AtoZPlugins/.github/workflows/release.yml`）：

1. `npm ci` → 校验并打包 `plugins/`，生成 `registry.json`
2. 创建/复用 GitHub Release，上传 `dist/*.zip`
3. 把 `registry.json` 提交回 `main`
4. 配了 `GITEE_TOKEN` 时：推 `main` + tag 到 Gitee，并上传 zip 到 Gitee Release

首次发布前需要在 GitHub 仓库加 `GITEE_TOKEN`（Gitee 私人令牌，勾 `projects`）；
仓库路径不是 `yukai1998/AtoZPlugins` 时，用仓库变量 `GITEE_REPO` 覆盖。

## 四、索引格式

```json
[
  {
    "id": "hello-tool",
    "name": "Hello 工具示例",
    "version": "0.1.0",
    "description": "…",
    "category": "示例",
    "downloadUrl": "https://gitee.com/yukai1998/AtoZPlugins/releases/download/v0.1.0/hello-tool-0.1.0.zip",
    "mirrors": ["https://github.com/cocYu/AtoZPlugins/releases/download/v0.1.0/hello-tool-0.1.0.zip"],
    "sha256": "8dd364b8…",
    "size": 1294
  }
]
```

- 默认 **Gitee 主源、GitHub 镜像**（`--primary github` 可反转），任一可用即安装
- `sha256` 必填，下载后校验，不匹配直接拒绝
- 打包可复现：zip 内时间戳固定，同样的源文件两次打包 sha256 一致

## 五、主应用这一侧

| 位置 | 行为 |
| --- | --- |
| `src/main/plugins/manager.ts` | `DEFAULT_REGISTRY_URLS` 三源回退；`installRemote` 主地址 + `mirrors` 回退（最多 6 个），sha256 校验 |
| `plugins:remote-list` | 返回 `{ source, entries }`，`source` 是实际生效的索引地址 |
| `ToolMarketDialog.vue` | 记住自定义索引（localStorage）、显示当前来源与「含镜像」标记 |
| 环境变量 | `MYDASH_TOOLS_REGISTRY=https://…/registry.json` 可临时覆盖默认索引（逗号分隔多源） |

默认索引：

```
https://gitee.com/yukai1998/AtoZPlugins/raw/main/registry.json
https://cdn.jsdelivr.net/gh/cocYu/AtoZPlugins@main/registry.json
https://raw.githubusercontent.com/cocYu/AtoZPlugins/main/registry.json
```

仓库改名或想自建索引时，改这三行即可；普通用户也可以在「获取工具」里填自定义地址。

## 六、安全边界

插件运行在渲染层主世界（与主应用同一个 JS 上下文），`permissions` 是声明式约束、**不是沙箱**。
插件中心的写权限等同于所有用户的执行权限：

- 只合并可信 PR，重点审 `eval`、动态远程脚本、越权数据访问
- 包体积上限 10MB（脚本强制），插件会随数据同步备份
- `sha256` 防包被篡改，防不了索引被替换；需要更强保证可加 registry 的 Ed25519 签名（待做）

## 七、FAQ

**Q：插件版本改了，用户会收到更新吗？**
A：会。索引里 `version` 变大后，「获取工具」显示「更新」按钮，点击覆盖安装，KV 与启停状态保留。

**Q：能同时有多个索引吗？**
A：内置的是多源回退（同一份索引的多个镜像）；自定义索引是单选。想做「官方 + 第三方」并存，需要扩展成索引数组，目前未做。

**Q：Gitee 没配 token 会怎样？**
A：GitHub Release 与索引照常，Gitee 镜像跳过；应用会回退到 jsDelivr / GitHub raw，境内可能慢。

**Q：插件包很大可以吗？**
A：脚本限制单插件 10MB（zip 前源文件总和）。插件会进数据同步备份，别放大型资源。
