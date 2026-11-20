# 插件中心：用 GitHub / Gitee 分发插件

插件的源码、打包与发行都放在独立仓库 **`my-dash-plugins`**（本机 `E:\project\electorn\AtoZPlugins`），
主应用只负责读取索引与安装。这样插件可以独立发版，不必跟着应用走 release。

```
my-dash-plugins  ──tag vX.Y.Z──►  GitHub Actions  ──►  GitHub Release（zip）
                                    │                     │
                                    ├─ 回写 registry.json ─┤
                                    └─ 镜像 ─► Gitee Release（zip + registry）
                                                          │
AtoZ 应用 ── 聚合插件源（默认源：Gitee raw → jsDelivr → GitHub raw）── 下载 zip（downloadUrl → mirrors）── 安装
```

## 一、插件中心仓库结构

```
my-dash-plugins/
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

流水线（`my-dash-plugins/.github/workflows/release.yml`）：

1. `npm ci` → 校验并打包 `plugins/`，生成 `registry.json`
2. 创建/复用 GitHub Release，上传 `dist/*.zip`
3. 把 `registry.json` 提交回 `main`
4. 配了 `GITEE_TOKEN` 时：推 `main` + tag 到 Gitee，并上传 zip 到 Gitee Release

首次发布前需要在 GitHub 仓库加 `GITEE_TOKEN`（Gitee 私人令牌，勾 `projects`）；
仓库路径不是 `yukai1998/my-dash-plugins` 时，用仓库变量 `GITEE_REPO` 覆盖。

## 四、索引格式

```json
[
  {
    "id": "hello-tool",
    "name": "Hello 工具示例",
    "version": "0.1.0",
    "description": "…",
    "category": "示例",
    "downloadUrl": "https://gitee.com/yukai1998/my-dash-plugins/releases/download/v0.1.0/hello-tool-0.1.0.zip",
    "mirrors": ["https://github.com/cocYu/my-dash-plugins/releases/download/v0.1.0/hello-tool-0.1.0.zip"],
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
| `src/main/plugins/sources.ts` | 插件源配置：`userData/plugin-sources.json`，每条含 `id / name / url / mirrors / enabled` |
| `src/main/plugins/manager.ts` | 聚合所有启用的源（源内仍按 主地址 → 备用地址 回退）；同 id 取版本最高；`installRemote` 支持 `mirrors` 回退（最多 6 个）+ sha256 校验 |
| `plugins:remote-list` | 不传参聚合全部启用源 → `{ results, entries }`；传 `sourceIds` 只测指定源；传 `url` 只认该地址 |
| 设置 → 插件 → 插件市场 | 搜索（名称/描述/分类/id）、分类过滤、安装/更新/重装；显示来源与不可用的源 |
| 设置 → 插件 → 插件源 | 增删改、启停、单源「测试」、「恢复默认」 |
| `ToolMarketDialog.vue` | 工具箱「获取插件」快捷入口，复用同一个市场组件 |

首次运行写入内置源「AtoZ 插件中心」（主地址 Gitee raw + 两个备用地址），之后以配置文件为准：

```json
// userData/plugin-sources.json
{
  "version": 1,
  "sources": [
    {
      "id": "official",
      "name": "AtoZ 插件中心",
      "url": "https://gitee.com/yukai1998/my-dash-plugins/raw/main/registry.json",
      "mirrors": [
        "https://raw.githubusercontent.com/cocYu/my-dash-plugins/main/registry.json",
        "https://cdn.jsdelivr.net/gh/cocYu/my-dash-plugins@main/registry.json"
      ],
      "enabled": true,
      "builtin": true
    },
    { "id": "src-a1b2c3", "name": "团队内部", "url": "http://192.168.1.10:8080/registry.json", "mirrors": [], "enabled": true }
  ]
}
```

`MYDASH_TOOLS_REGISTRY`（逗号分隔）只在**首次生成**配置时替换内置源，之后请用界面维护。

备用地址里 jsDelivr 排在 GitHub raw 之后是有意为之：它对 `@main` 有 12 小时边缘缓存，
`purge.jsdelivr.net` 也不保证立刻生效（CI 里仍会主动清一次）。若排在 raw 前面，发布后的一段时间内
可能用**旧索引**挡住后面的新索引，表现就是「包下载成功但 sha256 校验失败」。

## 六、安全边界

插件运行在渲染层主世界（与主应用同一个 JS 上下文），`permissions` 是声明式约束、**不是沙箱**。
插件中心的写权限等同于所有用户的执行权限：

- 只合并可信 PR，重点审 `eval`、动态远程脚本、越权数据访问
- 包体积上限 10MB（脚本强制），插件会随数据同步备份
- `sha256` 防包被篡改，防不了索引被替换；需要更强保证可加 registry 的 Ed25519 签名（待做）

## 七、FAQ

**Q：插件版本改了，用户会收到更新吗？**
A：会。索引里 `version` 变大后，插件市场显示「更新」按钮，点击覆盖安装，KV 与启停状态保留。

**Q：能同时有多个索引吗？**
A：可以。「设置 → 插件 → 插件源」里加多条即可，市场会把所有启用的源聚合起来：同一插件出现在多个源时取版本最高的一份（版本相同取靠前的源），下载时按该条目自己的 `downloadUrl` → `mirrors` 回退。单个源不可用不影响其它源，失败原因在市场上方提示。

**Q：Gitee 没配 token 会怎样？**
A：GitHub Release 与索引照常，Gitee 镜像跳过；应用会回退到 jsDelivr / GitHub raw，境内可能慢。

**Q：插件包很大可以吗？**
A：脚本限制单插件 10MB（zip 前源文件总和）。插件会进数据同步备份，别放大型资源。
