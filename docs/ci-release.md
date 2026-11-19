# 三端发行流水线（GitHub Actions → Gitee Release）

推送 `release/vX.Y.Z` tag 后，自动构建 Windows / macOS / Linux 安装包，并发布到
**Gitee 仓库的「发行版」页面**，附件可直接下载。

配置入口：

- `.github/workflows/release.yml`：三端构建 + 汇总发布
- `scripts/ci/build-and-publish.mjs`：单平台构建与 Gitee Release 发布
- `scripts/ci/tag-release.mjs`：打 tag 并同时推 Gitee / GitHub
- `electron-builder.yml`：三端打包目标与产物命名

## 为什么不用 Gitee Go

Gitee Go 的云端构建机只有 **Linux 容器**，Node 插件最高 15.x（本项目需要 Node 22），
而 macOS 的 dmg 必须在 macOS 上构建；免登录的「主机管理 / 主机组」是付费能力，
个人免费版没有。三条限制叠加，Gitee Go 无法产出三端安装包。

GitHub Actions 对公开仓库 **完全免费**，直接提供 `windows-latest` / `macos-latest` /
`ubuntu-latest` 三种构建机，因此用它构建、把产物回传到 Gitee Release。
私有仓库也可以，但每月 2000 分钟额度（macOS 按 10 倍计）。

## 一次性准备

### 1. GitHub 仓库

在 GitHub 新建一个仓库（空仓库即可，不要勾选初始化 README），然后添加远程并推送一次：

```bash
git remote add github git@github.com:<你的账号>/my-dash.git
git push github main
```

> 之后 Gitee 仍是主仓库，日常 `git push origin main` 不变；只有打 tag 时需要两边都推
> （`npm run release:tag` 会自动处理）。

### 2. Gitee 令牌

Gitee → 设置 → 私人令牌 → 生成新令牌，勾选 **projects** 权限，复制令牌。
到 GitHub 仓库 **Settings → Secrets and variables → Actions → New repository secret**：

| 名称 | 值 |
| --- | --- |
| `GITEE_TOKEN` | 上一步的令牌（必需） |

可选的仓库变量（**Variables**，不是 Secrets；不填用脚本默认值）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `GITEE_OWNER` | `yukai1998` | Gitee 仓库所属空间 |
| `GITEE_REPO` | `my-dash` | Gitee 仓库路径 |

### 3. 确认 Actions 已启用

GitHub 仓库 **Actions** 标签页若提示需要启用，点一下启用即可。

## 发版

```bash
npm run release:tag -- 0.0.2
```

这个命令会：校验版本与工作区 → 创建注释 tag `release/v0.0.2` → 先推 Gitee（Release 建在这个 tag 上）
→ 再推 GitHub（触发构建）。

也可以手动：

```bash
git tag -a release/v0.0.2 -m "AtoZ 0.0.2"
git push origin release/v0.0.2     # Gitee 先有 tag
git push github release/v0.0.2     # 触发构建
```

### 流水线做什么

```
build-windows ┐
build-macos   ├→ 三端并行构建，产物作为 artifact 上传
build-linux   ┘
      ↓
publish → 下载全部产物 → 创建/复用 Release → 分卷上传附件
```

单个 build 任务：

1. 从 tag 解析版本号 `0.0.2`，`npm version 0.0.2 --no-git-tag-version`（只改工作区，不回提交）
2. `npm ci`
3. 编译对应平台的 Go 后端到 `backend/bin/<win|mac|linux>/backend[.exe]`
   （macOS 分别编译 x64 / arm64 再用 `lipo` 合成通用二进制）
4. `electron-builder` 生成安装包
5. 产物上传为 workflow artifact（保留 7 天）

`publish` 任务在三个平台都成功后运行，把产物汇总到一个目录，由
`--platform all --publish-only` 统一上传。这样不会有三个任务同时创建 Release 的竞态。

产物命名：

```
AtoZ-0.0.2-win-x64-setup.exe
AtoZ-0.0.2-linux-x64.AppImage
AtoZ-0.0.2-linux-x64.deb
AtoZ-0.0.2-mac-x64.dmg / -arm64.dmg
AtoZ-0.0.2-mac-x64.zip / -arm64.zip
```

### 重跑

构建失败可以直接在 Actions 页面 **Re-run failed jobs**；想只重试发布，
手动运行 `Release` workflow，输入已存在的 tag（如 `release/v0.0.2`）。
已存在的同名附件会自动跳过。

## 附件大小限制

Gitee 普通仓库**单个附件不能超过 100MB**（GVP 200MB，企业版按套餐）。Windows 安装包约 120MB，
脚本会自动按 95MB 分卷上传：

```
AtoZ-0.0.2-win-x64-setup.exe.part1
AtoZ-0.0.2-win-x64-setup.exe.part2
```

下载全部分卷后合并：

- Windows：`copy /b 文件名.part1 + 文件名.part2 文件名`
- macOS / Linux：`cat 文件名.part* > 文件名`

如果仓库是 GVP 或企业版，把 workflow 里的 `GITEE_MAX_ASSET_MB` 调到 190/290，即可上传完整单文件。

## 本地 / 手动构建

在有环境的机器上（不需要 GitHub）：

```bash
GITEE_TOKEN=xxx RELEASE_TAG=release/v0.0.2 node scripts/ci/build-and-publish.mjs --platform windows
```

常用参数：

| 参数 | 作用 |
| --- | --- |
| `--platform windows\|macos\|linux` | 指定构建目标 |
| `--no-publish` | 只构建，不调用 Gitee API |
| `--skip-install` | 跳过 `npm ci`（依赖已就绪时） |
| `--publish-only` | 跳过构建，直接用目录里已有产物发布（上传失败重试） |
| `--platform all --publish-only` | 汇总目录里的三端产物一起发布 |
| `--dry-run` | 只打印将创建的 Release 与分卷计划，不发请求 |

`MYDASH_CI_OUT=dist-test` 可指定产物目录，避免覆盖 `dist/`。
`GITEE_API_BASE` 可覆盖 API 地址（私有化部署 / 本地 mock 测试用）。

也可以只用 npm 脚本打包：

```bash
npm run build:win
npm run build:mac     # 需在 macOS 上执行
npm run build:linux
```

## 已知限制

- **未签名 / 未公证**：Windows 首次运行会有 SmartScreen 提示；macOS 会被 Gatekeeper 拦截，
  用户需右键「打开」或执行 `xattr -dr com.apple.quarantine /Applications/AtoZ.app`。
  正式分发建议配置代码签名与 Apple 公证（在 workflow 里加证书 Secret）。
- **macOS 构建耗时**：x64 + arm64 各出 dmg 与 zip，单次约 15-25 分钟；私有仓库按 10 倍计入额度。
- **Gitee tag 与 GitHub tag 要一致**：只推 GitHub 不推 Gitee 时，Release 会基于 Gitee 的 `main`
  补建一个 tag，位置可能不对。用 `npm run release:tag` 可以避免。
