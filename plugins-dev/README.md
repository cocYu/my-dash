# plugins-dev（本地开发沙箱）

dev 模式会扫描本目录，同 id 时优先于已安装版本，用于边写边调。

**官方插件不在这里**，统一维护在插件中心仓库 `AtoZPlugins`（本机路径
`E:\project\electorn\AtoZPlugins`，远程 Gitee/GitHub 同名仓库）。这里只放你正在改的插件。

## 用法

```bash
# 方式一：整仓克隆（推荐，随时可 pull 最新插件）
git clone git@gitee.com:yukai1998/AtoZPlugins.git plugins-dev

# 方式二：只放正在改的那一个
cp -r ../AtoZPlugins/plugins/my-tool plugins-dev/
```

放好后在主应用「设置 → 插件 → 重载全部」即可加载，`ctx.log` 输出在 DevTools Console。

除了本 README，目录内容已被 `.gitignore` 忽略，不会误提交到主仓库。
