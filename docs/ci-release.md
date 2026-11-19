# Gitee Go 三端发行流水线

推送 `release/x.y.z` tag 后，自动构建 Windows / macOS / Linux 安装包，并发布到仓库的
**发行版（Release）** 页面，附件可直接下载。

配置入口：

- `.workflow/release.yml`：流水线定义（tag 触发、三个阶段）
- `scripts/ci/build-and-publish.mjs`：各平台构建 + 发布脚本
- `electron-builder.yml`：三端打包目标与产物命名

## 为什么用「自托管主机组」

Gitee Go 的云端构建机是 Linux 容器，Node 插件最高只到 15.x；本项目是 Electron 45 + Vite 8，
需要 Node 22。另外 macOS 的 dmg 必须在 macOS 上构建，云端无法替代。

所以流水线只做调度：三端各准备一台构建机，通过 Gitee Go 的主机组接入，分别执行
`build-and-publish.mjs`。每台机器构建完，直接调用 Gitee API 把本平台产物传到同一个 Release。

> 如果暂时没有 macOS 构建机：可以先删掉 `stage-macos`，在 Mac 上手动执行同一条命令
> （见「本地/手动构建」），产物仍会进入同一个 Release。

> **能力边界**：Gitee Go 官方文档只保证 Linux 云构建与 Linux 主机/部署；Windows、macOS 的构建机
> 是否能作为「主机组」接入，取决于你的套餐与平台支持情况。若无法接入，保留 `shell@agent` 的
> `hostGroupID` 会报错，此时把对应阶段删掉，改在 Windows/Mac 上手动跑同一条发布命令即可。

## 一次性准备

### 1. 构建机环境

三台机器都需要：Git、Node.js 22、Go 1.26+（`go.mod` 要求 1.26，低版本会尝试自动下载工具链）。

| 平台 | 额外要求 |
| --- | --- |
| Windows | 无（electron-builder 会自动下载 NSIS；建议装 7-Zip 便于排查） |
| Linux | `libgtk-3-0`、`libnss3`、`fakeroot`、`dpkg`（deb 打包用）等常规 Electron 构建依赖 |
| macOS | Xcode Command Line Tools（`xcode-select --install`），用于 `lipo` 合并双架构后端 |

构建机会执行 `npm ci`（下载 Electron 等），请保证网络能访问 npm 源；国内可先配置镜像。

### 2. 接入主机组

Gitee 仓库 → **设置 → 主机管理**（或在企业/组织设置里）→ 新建主机组，按页面命令在目标机器安装 Agent，
并关联本仓库。创建后记下每个主机组的 **hostGroupID**。

### 3. 配置令牌

在 Gitee → 设置 → 私人令牌创建 token，勾选 **projects** 权限；然后把它配置成流水线的环境变量
`GITEE_TOKEN`（不要写进 YAML 或提交到仓库）。

其他变量（可选）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `GITEE_OWNER` | `yukai1998` | 仓库所属空间 |
| `GITEE_REPO` | `my-dash` | 仓库路径 |
| `GITEE_MAX_ASSET_MB` | `95` | 单附件上限；GVP 可设 190，企业版按套餐 |
| `GITEE_BRANCH` | `main` | 创建 Release 时关联的分支 |

### 4. 填 hostGroupID

编辑 `.workflow/release.yml`，把三个 `REPLACE_WITH_*_HOST_GROUP_ID` 换成真实 ID。

## 发版

```bash
git tag release/0.2.0
git push origin release/0.2.0
```

流水线按 Windows → Linux → macOS 顺序执行（阶段串行）：

1. 从 tag 解析版本号 `0.2.0`，执行 `npm version 0.2.0 --no-git-tag-version`（只改工作区，不回提交）
2. `npm ci`
3. 编译对应平台的 Go 后端到 `backend/bin/<win|mac|linux>/backend[.exe]`（macOS 用 `lipo` 合成 x64+arm64 通用二进制）
4. `electron-builder` 生成安装包
5. 创建/复用 `release/0.2.0` 的 Release，上传本平台产物

产物命名：

```
AtoZ-0.2.0-win-x64-setup.exe
AtoZ-0.2.0-linux-x64.AppImage
AtoZ-0.2.0-linux-x64.deb
AtoZ-0.2.0-mac-x64.dmg / -arm64.dmg
AtoZ-0.2.0-mac-x64.zip / -arm64.zip
```

## 附件大小限制

Gitee 普通仓库**单个附件不能超过 100MB**（GVP 200MB，企业版按套餐）。当前安装包约 120MB，
脚本会自动按 95MB 分卷上传：

```
AtoZ-0.2.0-win-x64-setup.exe.part1
AtoZ-0.2.0-win-x64-setup.exe.part2
```

下载全部分卷后合并：

- Windows：`copy /b 文件名.part1 + 文件名.part2 文件名`
- macOS / Linux：`cat 文件名.part* > 文件名`

如果仓库是 GVP 或企业版，把 `GITEE_MAX_ASSET_MB` 调到 190/290，即可上传完整单文件。

> 想进一步缩小安装包，可继续把主进程依赖打进 bundle（目前只裁掉了渲染层依赖），
> 或使用 `electronLanguages` 只保留需要的语言包（已启用）。

## 本地 / 手动构建

只构建、不发布（本地验证推荐）：

```bash
RELEASE_TAG=release/0.1.0 node scripts/ci/build-and-publish.mjs --platform windows --no-publish --skip-install
```

常用参数：

| 参数 | 作用 |
| --- | --- |
| `--no-publish` | 只构建，不调用 Gitee API |
| `--skip-install` | 跳过 `npm ci`（依赖已就绪时） |
| `--publish-only` | 跳过构建，直接用 `dist/` 里已有产物发布（上传失败重试） |
| `--dry-run` | 只打印将创建的 Release 与分卷计划，不发请求 |

`MYDASH_CI_OUT=dist-test` 可指定输出目录，避免覆盖 `dist/`。
`GITEE_API_BASE` 可覆盖 API 地址（私有化部署/本地 mock 测试用）。

手动发某平台（已装好环境，等价于流水线里那一步）：

```bash
GITEE_TOKEN=xxx RELEASE_TAG=release/0.2.0 node scripts/ci/build-and-publish.mjs --platform macos
```

也可以直接用 npm 脚本只构建：

```bash
npm run build:win
npm run build:mac
npm run build:linux
```

## 已知限制

- **未签名/未公证**：Windows 首次运行会有 SmartScreen 提示；macOS 会被 Gatekeeper 拦截，
  用户需右键「打开」或执行 `xattr -dr com.apple.quarantine /Applications/AtoZ.app`。
  正式分发建议配置代码签名与 Apple 公证。
- **重复执行**：同一 tag 重复跑流水线时，已存在的同名附件会跳过；需要覆盖时先在 Release 页面删除旧附件。
- **构建机在线**：自托管主机离线时流水线会一直等待/失败，请保证三台机器常开。
