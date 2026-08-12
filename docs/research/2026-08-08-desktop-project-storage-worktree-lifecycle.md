# 桌面开发工具的项目存储与 Worktree 生命周期

核验日期：2026-08-08

本快照只使用 Electron、VS Code、Git 和 OpenAI 的官方文档或公开源码。它是对
[`system-boundaries.md`](../design-docs/system-boundaries.md) 的证据输入；已吸收的 Host /
`projectId` / 分根存储决定以 design-doc 为准，本文只保留一手事实与尚未写入规范的细节。

## 已确认的一手事实

### Electron：Host 决定目录，`userData` 不是大文件仓库

`Observed`：Electron 的 `app.getPath()` 明确区分 `userData`、`sessionData`、`temp`、
`logs` 和 `crashDumps`。`userData` 用于应用配置；官方还提醒不要把大型文件放进去，
因为部分环境会备份该目录。Chromium 的 Cookie、Local Storage 和磁盘缓存默认进入
`sessionData`，后者默认又指向 `userData`；若要拆开，必须在 `ready` 前设置路径。
macOS 日志默认位于 `~/Library/Logs/<AppName>`。

来源：[Electron `app.getPath` 与 `setAppLogsPath`](https://www.electronjs.org/docs/latest/api/app#appgetpathname)

因此 Electron Main 适合只做原生路径发现和注入。Runtime Core 不应 import Electron，
也不应在生产环境自行回退到 `os.tmpdir()`。当前 Electron API 的公开 `getPath` 名称中
没有通用的应用业务 `cache` 槽位；`cacheDir` 应由平台 Host 单独解析，不能假称来自
`app.getPath("cache")`。

### VS Code：应用级目录下再按稳定 workspace ID 隔离

`Observed`：VS Code 的 Extension API 区分全局状态、工作区状态、全局存储、工作区
私有存储、日志和 SecretStorage；`storageUri` 在没有打开 folder/workspace 时为空。

来源：[VS Code `ExtensionContext`](https://code.visualstudio.com/api/references/vscode-api#ExtensionContext)

`Observed`：桌面源码把每个 workspace 的 SQLite 放在
`workspaceStorageHome/<workspace.id>/state.vscdb`，并写入 `workspace.json` 保存原始 folder
或 workspace URI。

来源：[VS Code `WorkspaceStorageMain`](https://github.com/microsoft/vscode/blob/main/src/vs/platform/storage/electron-main/storageMain.ts#L1812-L1928)

`Observed`：VS Code 对 `.code-workspace` 文件使用路径哈希；对本地单目录 workspace，
ID 使用目录路径并加入 inode（Linux）或 birth time（macOS/Windows），使“同一路径删除后
重建”得到新身份。非 Linux 平台还会做大小写归一。

来源：[VS Code workspace identifier 源码](https://github.com/microsoft/vscode/blob/main/src/vs/platform/workspaces/node/workspaces.ts#L464-L581)

这说明“路径可参与查找”是成熟做法，但 VS Code 的 ID 解决的是 UI workspace 存储槽位，
不是跨移动保持不变的业务身份。

`Observed`：VS Code 允许用 `--user-data-dir` 启动相互隔离的实例。这证明完整实例隔离
可作为诊断能力，但不意味着多项目桌面应用必须默认为每个项目创建进程。

来源：[VS Code CLI：隔离实例](https://code.visualstudio.com/docs/configure/command-line#_isolating-vs-code-instances)

### Codex：公开了 Worktree 产品生命周期，但没有公开桌面内部实现

`Observed`：Codex 桌面把 Local checkout 定义为用户已有仓库，把 managed worktree
定义为由该 checkout 创建的后台 checkout；一个 chat 在 Local 与 Worktree 之间 Handoff
后，仍会回到同一个关联 worktree。默认 worktree 位于 `$CODEX_HOME/worktrees`，从所选
分支的 `HEAD` 创建并使用 detached HEAD。永久 worktree 会成为独立项目且不会自动删除。

来源：[OpenAI Codex Worktrees](https://developers.openai.com/codex/app/worktrees)

`Observed`：managed worktree 是一 chat 一环境的轻量资源。Codex 默认保留最近 15 个；
进行中、Pinned 或永久 worktree 不会自动删除。删除前保存快照，之后可以恢复。忽略文件
只有在 `.worktreeinclude` 明确列出时才复制，且不会覆盖目标已有文件。

来源：[OpenAI Codex Worktree cleanup](https://developers.openai.com/codex/app/worktrees#worktree-cleanup)

`Observed`：公开 Codex CLI 源码把全局状态放在可由 `CODEX_HOME` 覆盖的目录，日志默认
放在 `$CODEX_HOME/log`，并明确区分持久 Session 与 `ephemeral` Session。

来源：[Codex CLI config 源码](https://github.com/openai/codex/blob/main/codex-rs/core/src/config/mod.rs#L3682-L3724)

`Not verified`：Codex 桌面端的 project ID 算法、canonical path 规则、项目注册表或数据库
Schema、Electron `userData`/Cache 的实际映射、快照格式、删除事务和 app-server 进程拓扑
没有公开源码可核验。OpenAI 维护者公开说明桌面 App 未开源，它构建于开源 app-server
接口之上；因此不能从 UI 表象反推这些内部实现，也不能把 `$CODEX_HOME/worktrees` 当成
Symphony 契约。Symphony Workspace 证据见
[`2026-08-09-openai-symphony-workspace-layout.md`](2026-08-09-openai-symphony-workspace-layout.md)。

来源：[OpenAI 官方仓库维护者答复](https://github.com/openai/codex/discussions/16538#discussioncomment-16220374)

### Git：Worktree 是共享仓库、独立 checkout，不是独立 clone

`Observed`：一个 Git repository 有一个 main worktree 和零到多个 linked worktree。
linked worktree 与源仓库共享对象和大部分 refs，但拥有独立的 `HEAD`、index 等管理文件；
同一个 branch 默认不能同时在多个 worktree checkout。

`Observed`：`git worktree remove` 默认只删除 clean worktree；dirty 或含 submodule 的
worktree 需要 `--force`。目录被手工删除后，`prune` 只清除残留管理信息；路径被手工移动
后应使用 `repair` 恢复双向连接。`list --porcelain -z` 是供程序读取的稳定格式。

来源：[Git `worktree` 文档](https://git-scm.com/docs/git-worktree)

## 仍未写入规范的细节提示

下列细节支撑设计讨论，但不应再在 research 里复述已进
[`system-boundaries.md`](../design-docs/system-boundaries.md) 的 Host 决定：

- VS Code inode / birthtime 身份算法 ≠ Symphoneer 业务 `projectId`
- Electron 无通用业务 `cache` 槽位；`sessionData` 默认同 `userData`
- Codex 公开 TTL（最近 15 个）、`.worktreeinclude`、Local↔Worktree Handoff
- dirty worktree 禁止无 `--force` 的自动删除；意外丢失与安全释放要区分
