# Executor 上下文注入与管理

> Decision status: Accepted  
> Implementation evidence: Partial — Codex 路径有确定性契约覆盖并记录 `instructionSources`；Claude Code 真实 Smoke 与环境隔离仍为 `Not verified`

本文件说明一次 Attempt 中，Symphoneer 提供什么上下文、Executor 自己加载什么上下文，以及这些内容如何续跑和留证。它不复制 Provider 的完整协议。

## 上下文链路

```text
Tracker Task + Attempt 序号
          │
          ▼
ProjectProfile（.symphoneer/WORKFLOW.md）
          │  严格 Liquid 渲染
          ▼
首个 Prompt ───────────────┐
                            ▼
Workspace cwd ───────► Executor 原生 Session
                            │
                            ├─ Codex：Thread / Turn + AGENTS.md
                            └─ Claude：Session + CLAUDE.md / 本地配置
                            │
                            ▼
后续 Turn：短续跑指令 + 同一 Session
```

## Symphoneer 注入的内容

1. Runtime 只从受管项目读取 `.symphoneer/WORKFLOW.md`。这个文件同时提供项目配置和 Prompt 模板；根 `WORKFLOW.md` 不参与加载。
2. 首次 Turn 用严格 Liquid 模式渲染模板。模板输入只有完整的当前 `TaskSummary`（`issue`）和上一次 Attempt 序号（`attempt`）；首次执行的 `attempt` 是 `null`。
3. Prompt 作为普通用户文本交给 Executor。Symphoneer 不把自身配置注入其他目标项目，也不拼接 `AGENTS.md`、`CLAUDE.md` 或 Provider 系统提示词。
4. 每个 Turn 结束后 Runtime 重新读取 Tracker。任务仍可路由且未达到 `maxTurns` 时，后续 Turn 只发送固定的短续跑指令，不重复发送完整 Workflow Prompt。
5. Workspace 的绝对路径同时作为 Executor 进程和 Session 的 `cwd`。因此 Provider 原生的项目指令发现以目标 Workspace 为根，而不是以 Symphoneer 仓库为根。

`maxTurns` 只约束一个 Attempt 内的 Session；跨 Attempt 的自动续跑由 `agent.max_attempts` 约束。达到上限后不再启动新的 Executor 进程，直到人显式重新尝试。

## Executor 原生上下文

| 边界 | Codex App Server | Claude Code CLI |
|---|---|---|
| Session | `thread/start` 或 `thread/resume`；Worker 内顺序复用 Thread | 首次启动 Session；已有 ID 时用 `--resume` |
| 项目指令 | Codex 按 `cwd` 自行发现 `AGENTS.md`；Symphoneer 不读取或重写其内容 | Claude Code 按 `cwd` 使用其本地配置与项目指令；Symphoneer 不管理凭据 |
| 可观察来源 | 保存 App Server 返回的 `instructionSources` 路径，并随 `ExecutionSession` 投影 | 当前公开 stream 未投影等价的指令来源列表 |
| Provider 设置 | model、approval policy、sandbox 和 effort 通过原生请求传入 | model、permission mode 与额外 argv 通过 CLI 参数传入 |
| 环境变量 | 继承宿主环境副本，但启动前移除 `GITHUB_TOKEN`、`GH_TOKEN` | 当前继承宿主环境，尚无等价过滤 |

`instructionSources` 只是 Codex 声明已加载的路径证据，不保存文件正文，也不证明指令正确执行。Claude Code 没有这项投影时，UI 不应伪造“未加载”或“已加载”的结论。

## 生命周期与权威

- `Task` 和验收事实属于 Tracker；Prompt 是当次输入快照，不是新的 Task 真相。
- `Attempt` 属于 Symphoneer；Provider Session ID 只是 Attempt 的运行引用。
- Worker 在一个 Attempt 内持有一个 Executor 进程和一个原生 Session；同一时间只允许一个活跃 Turn。
- Turn 正常完成只表示本轮结束。Runtime 必须在 Tracker 重读后决定继续、停止、重试或交给人。
- Prompt 指纹、Provider 版本、Session ID、活动和可用的指令来源进入投影；原始 Provider payload、凭据和项目指令正文不进入 Domain Event 或 Operator Log。

## 当前缺口

- Claude Code 子进程尚未像 Codex 一样过滤 Tracker 凭据；在补齐并完成真实 fixture Smoke 前，其安全边界保持 `Not verified`。
- Codex 只显式过滤 GitHub CLI 常用的两个环境变量；其他敏感环境是否需要最小 allowlist，应由独立安全验收决定，不能把现状描述成完整隔离。
- 两个 Adapter 只共享 `AgentRunner → AttemptWorker → RunHandle` 已经需要的语义；不增加 Provider registry、统一系统提示词或虚构的通用指令来源模型。

当前对象与控制边界见 [`system-boundaries.md`](system-boundaries.md)，用户流程见 [`delivery-flow.md`](delivery-flow.md)，Codex 外部协议证据见 [`../references/codex-app-server.md`](../references/codex-app-server.md)。具体实现和 Smoke 状态以关联 Issue / PR 为准。
