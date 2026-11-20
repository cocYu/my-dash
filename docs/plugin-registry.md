# 工具仓库：用 GitHub / Gitee 分发插件

> 目标：插件（工具箱工具 / 页面 / 仪表盘小组件）独立于主应用发版，用户在内置的「获取工具」里看到列表、一键安装与升级。

---

## 一、已经具备的能力

主应用这边不需要新的运行时机制，现有链路已经打通：

| 能力 | 位置 |
| --- | --- |
| 插件清单校验、zip 导入、覆盖升级 | `src/main/plugins/manager.ts` |
| 远程索引拉取（多源回退） | `plugins:remote-list` |
| 下载安装（主地址 + 镜像，sha256 校验） | `plugins:install-remote` |
| 界面「获取工具」 | `src/renderer/src/toolbox/ToolMarketDialog.vue` |
| 示例插件 | `plugins-dev/hello-tool`、`plugins-dev/notes-stats` |

缺的只是「把插件打成包、生成索引、发到 Release」这条流水线，本次已补齐。

## 二、仓库怎么放：两种形态

### 形态 A：与主应用同仓（默认，零额外配置）

```
my-dash/
├── plugins-dev/              # 插件源码（每个子目录一个插件）
│   ├── hello-tool/
│   └── notes-stats/
├── tools-registry/
│   └── registry.json         # 索引（CI 自动回写）
└── .github/workflows/
    └── tools-release.yml     # 工具发布流水线
```

- 优点：不用建新仓库，插件与主应用同版本演进
- 缺点：插件发布要动主仓的 `main`；外部贡献者 PR 会混在应用代码里
- 适用：插件由你自己维护、数量少于 10 个

### 形态 B：独立工具仓库（插件多 / 接受社区贡献时推荐）

新建一个仓库（如 `atoz-tools`），把 `plugins-dev/` 的内容放到它的 `plugins/` 下，并把
`scripts/tools/`、`.github/workflows/tools-release.yml` 一并复制过去：

```
atoz-tools/
├── plugins/
│   └── json-schema/
│       ├── plugin.json
│       └── index.js
├── registry.json             # 仓库根目录，raw 地址更短
├── scripts/build-tools.mjs
└── .github/workflows/tools-release.yml
```

然后只改两处：

1. 打包命令里的 `--src plugins`、`--github-repo <你>/atoz-tools`、`--gitee-repo <你>/atoz-tools`
2. 主应用 `src/main/plugins/manager.ts` 里的 `DEFAULT_REGISTRY_URLS` 指向新仓库

用户也可以不更新应用：在「获取工具」的输入框里填自建索引地址，会记在本地（`localStorage`）。
开发者还能用环境变量临时覆盖：`MYDASH_TOOLS_REGISTRY=https://.../registry.json npm run dev`。

## 三、发一次工具版本

### 1. 改版本号

编辑 `plugins-dev/<id>/plugin.json` 的 `version`（语义化版本）。插件 id 不要改——升级靠 id 覆盖，
改了就等于换一个插件（用户旧版本不会自动清理）。

### 2. 本地校验 / 打包

```bash
# 只校验清单与入口文件
node scripts/tools/build-tools.mjs --check

# 本地打包（产物在 dist-tools/，地址指向 tools/v0.1.0 的 Release）
node scripts/tools/build-tools.mjs \
  --src plugins-dev --out dist-tools \
  --tag tools/v0.1.0 \
  --github-repo cocYu/my-dash \
  --gitee-repo yukai1998/my-dash
```

产物：

```
dist-tools/
├── hello-tool-0.1.0.zip     # plugin.json 在包根目录
├── notes-stats-0.1.0.zip
├── registry.json            # 应用读取的索引
└── release-notes.md         # Release 正文
```

打包是**可复现**的（zip 内时间戳固定），同样的源文件两次打包 sha256 一致，便于校验。

### 3. 打 tag 触发发布

```bash
git tag -a tools/v0.1.0 -m "工具仓库 0.1.0"
git push origin tools/v0.1.0        # Gitee
git push github tools/v0.1.0        # GitHub（流水线跑在这里）
```

流水线 `.github/workflows/tools-release.yml` 会：

1. 校验并打包 `plugins-dev/` 下所有插件
2. 创建 / 复用 GitHub Release `tools/v0.1.0`，上传 zip（`--clobber` 可重跑）
3. 把 `registry.json` 回写到 `main`（Gitee 与 GitHub raw 立即可读）
4. 若配置了 `GITEE_TOKEN`：把 `main` 与 tag 推到 Gitee，并上传 zip 到 Gitee Release

也可以在 Actions 页面手动运行（填已存在的 tag，可只发布指定插件）。

### 4. 验证

```bash
# 索引能读到、字段正确
curl -s https://gitee.com/yukai1998/my-dash/raw/main/tools-registry/registry.json

# 包能下、哈希一致
curl -L -o /tmp/t.zip https://github.com/cocYu/my-dash/releases/download/tools/v0.1.0/hello-tool-0.1.0.zip
sha256sum /tmp/t.zip
```

应用里：工具箱 → 获取工具 → 看到列表 → 安装/更新。

## 四、索引格式

```json
[
  {
    "id": "hello-tool",
    "name": "Hello 工具示例",
    "version": "0.1.0",
    "description": "…",
    "category": "其他",
    "downloadUrl": "https://gitee.com/<owner>/<repo>/releases/download/tools/v0.1.0/hello-tool-0.1.0.zip",
    "mirrors": ["https://github.com/<owner>/<repo>/releases/download/tools/v0.1.0/hello-tool-0.1.0.zip"],
    "sha256": "8dd364b8…",
    "size": 1294
  }
]
```

- `downloadUrl` 主源（默认 Gitee，境内直连快），`mirrors` 依次回退（最多取 5 个），任意一个成功即安装
- 想反过来（GitHub 主源）打包时加 `--primary github`
- `sha256` 强烈建议保留：索引与包不一致时会拒绝安装
- `size` 仅用于展示，可省略
- 索引地址本身有多源回退：Gitee raw → jsDelivr → GitHub raw（顺序在 `manager.ts` 里）

## 五、安全边界

插件运行在**渲染层主世界**，与主应用同一个 JS 上下文，`permissions` 只是声明式约束，不是硬沙箱。因此：

1. **只发布 / 只安装可信来源**，索引仓库的写权限等同于所有用户的执行权限
2. 索引与包都走 https，`sha256` 防篡改但不防「索引本身被换掉」——仓库被入侵时哈希也会被改
3. 需要更强保证时，下一步可以做 **registry 签名**：用 Ed25519 对 `registry.json` 签名，应用内置公钥校验；这需要主进程引入签名校验，属于后续增强
4. 上架前人工过一遍：`plugin.json` 的 `permissions` 是否合理、入口有没有 `eval` / 远程脚本加载

## 六、常见问题

**Q：`tools/v0.1.0` 和主应用的 `release/v0.1.0` 会冲突吗？**
A：不会，两条流水线用不同 tag 前缀，互不触发。工具版本号与主应用版本号也不需要对齐。

**Q：只想发某一个插件？**
A：改它的 `version` 后打新 tag，或在 Actions 手动运行时填 `plugins=hello-tool`。

**Q：不配置 `GITEE_TOKEN` 会怎样？**
A：GitHub Release 与索引照常；Gitee 镜像跳过。应用拉索引时会自动回退到 jsDelivr / GitHub raw，但境内下载可能慢。

**Q：插件包多大合适？**
A：脚本限制单插件 10MB（zip 前源文件总和）。插件会随数据同步备份，别塞大资源。

**Q：Gitee 单附件 100MB 限制？**
A：插件包远小于该限制，不涉及分卷（主应用安装包才需要）。
