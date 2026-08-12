# OpenAI Symphony Workspace 布局与清理

> 核验日期：2026-08-09  
> Evidence status：`Observed` — 仅使用 OpenAI 官方 Symphony 仓库、规范、参考实现与 Codex 官方文档  
> 固定源码版本：[`openai/symphony@f8e8b8a`](https://github.com/openai/symphony/tree/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7)  
> 作用：研究输入，不自动改变 Symphoneer 的规范性设计或实现

## 结论

1. **Symphony 的 Workspace 隔离单位是 Issue，不是 Attempt。** 路径是
   `<workspace.root>/<workspace_key>`；后续 Turn、重试和新的 worker attempt 都复用该
   Issue 的确定性目录。规范没有 `attempt-<id>` 这一层。
2. **官方 Symphony 不要求、参考实现也不内建 Git worktree。** Core 只创建目录；仓库
   clone、sync 或 worktree 策略属于实现自定义，通常放在 lifecycle hooks。官方示例是在
   `after_create` 中执行 `git clone ... .`。
3. **`workspace.root` 属于 `WORKFLOW.md` 配置。** 缺省值是
   `<system-temp>/symphony_workspaces`；`~`、显式 `$VAR` 和相对路径有明确解析规则。
4. **官方布局没有应用级 `<projectId>` 命名空间。** 一个 Symphony service 读取一个
   workflow，并由 tracker adapter 限定一个 tracker scope。规范只要求 Issue identifier
   在该 scope 内唯一；它没有解决多个 service 共享同一个 root 时的跨项目重名问题。
5. **Codex 的有效 `cwd` 始终是绝对的 per-Issue Workspace。** 参考实现同时把它用于
   app-server 子进程目录、`thread/start.params.cwd` 和 `turn/start.params.cwd`，并在启动前
   拒绝 root 本身、root 外路径和 symlink escape。
6. **清理由 Tracker 终态驱动，不由 Attempt 完成驱动。** 正常成功不会删除 Workspace；
   Issue 进入 terminal state 或服务启动时发现 terminal Issue 才回收。新目录的
   `after_create` 失败时，参考实现也会删除半成品目录。

## 1. `WORKFLOW.md` 与 `workspace.root`

`Observed`：规范选择 workflow 文件的顺序是“显式 runtime 路径，否则当前工作目录的
`WORKFLOW.md`”。相对 `workspace.root` 以选中的 `WORKFLOW.md` 所在目录为基准，而不是
以启动进程的任意 cwd 为基准。

- 规范配置解析与相对路径规则：
  [`SPEC.md` L535-L558](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L535-L558)
- Elixir 默认 workflow 路径：
  [`workflow.ex` L8-L18](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/workflow.ex#L8-L18)
- Elixir 将 root 相对 workflow 目录展开：
  [`config.ex` L88-L93](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/config.ex#L88-L93)

`Observed`：`workspace.root` 缺省为系统临时目录下的 `symphony_workspaces`。它支持
`~`，显式 `$VAR` 会先解析，最终值在使用前规范化为绝对路径。

- 规范字段定义：
  [`SPEC.md` L410-L418](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L410-L418)
- Elixir schema 默认值：
  [`schema.ex` L107-L121](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/config/schema.ex#L107-L121)
- Elixir effective config 的 fallback：
  [`schema.ex` L452-L455](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/config/schema.ex#L452-L455)

官方仓库自身没有使用默认临时目录，而是在示例 workflow 中显式设置
`~/code/symphony-workspaces`：
[`elixir/WORKFLOW.md` L18-L29](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/WORKFLOW.md#L18-L29)。
因此，tmpdir 是规范 fallback，不是官方对长期生产存储位置的推荐。

## 2. Issue 与 Attempt 的目录命名

`Observed`：规范把 Workspace 定义为“分配给一个 Issue identifier 的文件系统目录”，
而 Run Attempt 是单独的运行记录，其中只引用 `workspace_path`：
[`SPEC.md` L221-L243](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L221-L243)。

路径公式固定为：

```text
<workspace.root>/<workspace_key>
```

规范明确相同 Issue 的运行复用 Workspace，成功运行不自动删除：
[`SPEC.md` L851-L880](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L851-L880)。

`workspace_key` 的当前规则是：

1. 保留 `[A-Za-z0-9._-]`；其他字符替换为 `_`。
2. 如果替换改变了原 identifier，追加原值的稳定 hash，至少 64-bit entropy，避免
   `A/B` 与 `A:B` 之类的清洗碰撞。

规范证据：
[`SPEC.md` L295-L312](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L295-L312)。
Elixir 参考实现使用 SHA-256 的前 16 个十六进制字符：
[`workspace.ex` L259-L287](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/workspace.ex#L259-L287)。

`Observed`：每次 worker attempt 都调用 `create_for_issue`；已有目录直接复用。一个 worker
生命周期内的 continuation turns 继续使用同一个 `workspace` 和同一个 app-server
session：

- 创建或复用：
  [`agent_runner.ex` L38-L50](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/agent_runner.ex#L38-L50)、
  [`workspace.ex` L15-L31](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/workspace.ex#L15-L31)
- 同一 Workspace 内继续 Turn：
  [`agent_runner.ex` L88-L126](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/agent_runner.ex#L88-L126)

因此，`<task>/<attempt-id>` 或“一 Attempt 一 worktree”都属于 Symphoneer 可选择的产品扩展，
不是 Symphony conformance 要求。

## 3. Git clone 与 worktree 的边界

`Observed`：Symphony 规范不假设 VCS，也不要求内建 checkout、clone 或 Git worktree。
Workspace population/synchronization 明确是 implementation-defined，可以由
`after_create`/`before_run` hooks 完成：
[`SPEC.md` L882-L901](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L882-L901)。

官方 Elixir workflow 的 `after_create` 直接在空 Workspace 中执行浅克隆：
[`elixir/WORKFLOW.md` L20-L29](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/WORKFLOW.md#L20-L29)。
README 也把 `git clone ... .` 描述为 Git-backed repository 的 hook 示例：
[`elixir/README.md` L166-L173](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/README.md#L166-L173)。

所以准确称呼应是“per-Issue Workspace”。只有某个具体实现的 hook/adapter 真正调用
`git worktree` 时，该目录才是 Git worktree。

## 4. 跨项目隔离

`Observed`：Core 路径只含 `workspace.root` 和 `workspace_key`，没有 `projectId`、repository
slug 或 tracker kind。规范同时要求 `issue.identifier` 在“configured tracker scope”内唯一：
[`SPEC.md` L295-L312](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L295-L312)。

`Observed`：Elixir 参考实现由一个 workflow 配置一个 provider scope；例如 Linear 的读取
限定在一个 `project_slug`：
[`elixir/README.md` L207-L212](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/README.md#L207-L212)。

`Inference`：官方模型的隔离前提是“一 service / workflow / tracker scope + 独立 root”，
而不是一个应用进程在同一 root 内管理多个 Project。若多个 Symphony 实例共享 root，且
不同 tracker scope 出现相同 Issue identifier，官方路径公式本身不会隔离它们。要做
multi-project host，增加 `<project-id>` 层或为每个项目分配不同 root 是产品层责任，不是
当前 Symphony 规范行为。

## 5. Codex `cwd`

`Observed`：规范要求 app-server 子进程、Thread 和 Turn 都使用绝对 per-Issue Workspace
作为 cwd：
[`SPEC.md` L966-L996](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L966-L996)。

Elixir 参考实现做了三层绑定：

- 启动前 canonicalize Workspace/root，拒绝 root 本身、root 外路径和 symlink escape：
  [`app_server.ex` L150-L175](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/codex/app_server.ex#L150-L175)
- 本地 `Port.open` 的 `cd` 指向 Workspace；远程执行先 `cd`：
  [`app_server.ex` L192-L238](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/codex/app_server.ex#L192-L238)
- `thread/start` 和 `turn/start` 都显式发送相同的 `cwd`：
  [`app_server.ex` L314-L359](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/codex/app_server.ex#L314-L359)

Workspace hooks 也以 Workspace 为 cwd：
[`workspace.ex` L397-L405](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/workspace.ex#L397-L405)。

## 6. 清理生命周期

| 条件 | 规范行为 | 参考实现证据 |
|---|---|---|
| 正常/成功 Attempt 结束 | 保留 Workspace，供同 Issue 后续运行复用 | [`SPEC.md` L863-L866](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L863-L866) |
| 新建目录的 `after_create` 失败 | 实现可以删除半成品；Elixir 会删除 | [`workspace.ex` L21-L30](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/workspace.ex#L21-L30)、[`workspace.ex` L307-L320](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/workspace.ex#L307-L320) |
| 运行中 Issue 进入 terminal state | 停止 worker 并删除 Workspace | [`orchestrator.ex` L421-L439](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L421-L439)、[`orchestrator.ex` L554-L566](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L554-L566) |
| 服务启动 | 查询 terminal Issues 并清除对应 Workspace；查询失败只告警 | [`orchestrator.ex` L1160-L1174](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L1160-L1174) |
| Issue 离开 active 但不是 terminal | 停止 worker，不删除 Workspace | [`orchestrator.ex` L428-L439](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L428-L439) |

删除前运行 `before_remove`；其失败或超时被忽略，之后仍递归删除目录：
[`workspace.ex` L159-L162](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/workspace.ex#L159-L162)、
[`workspace.ex` L331-L395](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/workspace.ex#L331-L395)。
这不是 Git-aware cleanup；Git 分支、worktree registration 或未提交变更保护必须由具体
实现及 hook 自行负责。

## 7. 与 Codex Desktop 的区分

Codex Desktop 的 `$CODEX_HOME/worktrees`、一 Chat 一 worktree、TTL 与 Handoff 是**公开产品行为**，不是 Symphony 契约；一手证据与未开源边界见
[`2026-08-08-desktop-project-storage-worktree-lifecycle.md`](2026-08-08-desktop-project-storage-worktree-lifecycle.md)。
本次核验的 Symphony 仓库只通过 App Server 传入自管 `cwd`，不能从 Desktop 反推 Issue/Attempt 目录粒度。

## 对 Symphoneer 的对照

| Symphony 规范贴合 | Symphoneer 产品扩展（见 system-boundaries） |
|---|---|
| 路径稳定映射到 Issue，跨 Attempt 复用 | `<workspaceRoot>/<projectId>/…/attempt-…` |
| Git population 放在 hook/adapter | Host 注入 workspace root + Attempt worktree |
| cwd 为 canonicalize 后的绝对 Workspace | 同上：process / thread / turn 共用该 cwd |

