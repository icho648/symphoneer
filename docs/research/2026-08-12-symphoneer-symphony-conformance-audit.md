# Symphoneer / OpenAI Symphony Conformance 快速审计

> 核验日期：2026-08-12
>
> 官方来源范围：仅 OpenAI 官方 [`openai/symphony`](https://github.com/openai/symphony) 仓库
>
> Decision status：Research input，不自动更新 Symphoneer 的规范性设计
>
> Implementation evidence：官方侧为固定源码静态审计；Symphoneer 侧为当前工作树源码与测试静态审计，未执行真实 GitHub / Codex 端到端 Smoke

## 结论

**Symphoneer 当前满足若干 Symphony 核心对象和安全语义，但还不满足 Symphony“持续从 Tracker 自动派发”的端到端核心定义。**
它已有长期运行 Host、Tracker 周期刷新、可重放状态、Codex App Server Session、Workspace 生命周期、重试与 reconciliation
的确定性模块；不过生产路径仍由人类 `start_run` / `retry_attempt` / `send_attempt_input` 命令驱动，且 Workspace
选择了 per-Attempt Git worktree，而非 Symphony 的稳定 per-Issue Workspace。

官方 `main` 当前仍是
[`f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7`](https://github.com/openai/symphony/commit/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7)。
官方 compare 为
[`f8e8b8a...main`](https://github.com/openai/symphony/compare/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7...main)：
`identical`、ahead `0`、changed files `0`。因此 2026-08-09 的
[`产品表面快照`](2026-08-09-openai-symphony-product-surface.md)与
[`Workspace 快照`](2026-08-09-openai-symphony-workspace-layout.md)没有因上游变化而失效。

## 判定口径

- **Observed match**：当前生产路径或公共状态面可直接观察到与官方契约一致的行为。
- **Observed module only**：有确定性实现和测试，但没有接入当前生产守护进程主链。
- **Explicit deviation**：当前源码能确定采用不同语义，不等待 Smoke 才能判断。
- **Not verified**：静态证据不足，或本次没有执行匹配的真实运行验证。

## 证据矩阵

| 检查面 | Symphony 官方契约 | Symphoneer 当前证据 | 判定 |
|---|---|---|---|
| 核心服务 / 派发 | 长期运行服务按固定 cadence 读取 Tracker，在并发槽内自动 claim 与 dispatch；Orchestrator 是运行状态唯一权威。见 [`SPEC.md` goals/components](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L18-L124) 与 [`orchestration`](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L570-L660)。 | [`PollingCoordinator`](../../src/runtime/host/polling-coordinator.ts)提供 cadence、串行化和失败退避；但 Desktop Host 的 poll 只调用 [`refreshTracker`](../../src/runtime/host/desktop-runtime-host.ts)，而 [`RuntimeService`](../../src/runtime/service/runtime-service.ts)创建 `TrackerSynchronizer` 时没有 reconcile / dispatch 回调。生产源码没有构造 `CoreScheduler`；运行由 [`start_run`](../../src/runtime/service/commands.ts)命令触发。 | **Explicit deviation：**“持续刷新”已接入，“自动派发”未接入，尚非完整 Symphony daemon。 |
| Workspace / Attempt | 一个 Issue 稳定映射一个 `<workspace_root>/<issue_key>`；多个 Attempt / Turn 复用同一 Workspace。见 [`Workspace 与 Attempt`](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L221-L243)、[`path mapping`](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L295-L312) 和 [`reuse`](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L851-L880)。 | [`createWorkspaceReference`](../../src/runtime/workspace/reference.ts)明确生成 `<root>/<issue-key>/<attempt-key>`，Workspace ID / owner 绑定 Attempt；[`reference.test.ts`](../../tests/workspace/reference.test.ts)验证 retry 使用不同路径。Single Agent 每次 dispatch / retry 生成 UUID 与新 Git 分支。 | **Explicit deviation / product extension：**per-Issue namespace 下的 per-Attempt Git worktree；同一 Attempt continuation 复用，但新 Attempt 不复用。 |
| 同一 Issue continuation | Turn 正常结束后重新读取 Tracker；Issue 仍 active / routable 时，在同一 Session 与 Workspace 自动继续，直至停止条件或 `max_turns`。见 [`continuation`](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L662-L692)。 | [`SingleAgentOrchestration`](../../src/runtime/orchestration/single-agent.ts)可用保留的 `threadId` 与 Workspace `continuation: true`；但只由 `send_attempt_input` 触发。一次正常 Turn 后直接把 Attempt 标成 `succeeded`，没有自动 Tracker reread / loop，也没有应用已解析的 `maxTurns`。 | **Partial + Explicit deviation：**同 Session continuation 能力存在；官方自动 continuation loop 不存在。 |
| retry / reconciliation / cleanup | 失败指数退避；正常 continuation 短延迟；每次 retry 前重读 Tracker；每 tick / startup reconcile；terminal Issue 清理 Workspace。见 [`retry`](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L790-L839)、[`cleanup`](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L851-L880) 与 [`recovery`](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L1668-L1704)。 | [`CoreScheduler`](../../src/runtime/scheduler/core-scheduler.ts)及 [`retry.test.ts`](../../tests/scheduler/retry.test.ts)、[`reconciliation.test.ts`](../../tests/scheduler/reconciliation.test.ts)覆盖 1s continuation、10s 指数失败退避与状态 reconcile；但生产 Host 未接入它。Single Agent 失败只保留 Workspace 并标记 failed；retry 与删除分别由人工命令触发，没有 startup terminal cleanup 或 stall timer。 | **Observed module only；生产路径 Explicit deviation。** Workspace driver 的 ownership / dirty-state 安全检查是额外能力，不等于自动 cleanup 已接线。 |
| `WORKFLOW.md` | Repo-owned `WORKFLOW.md` 定义 config、Prompt、hooks；配置在运行中动态 reload，路径相对 workflow 文件解析。见 [`configuration`](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L410-L558) 与 [`hooks`](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L903-L926)。 | [`loadProjectProfile`](../../src/runtime/workflow/load.ts)解析类型化 config / Prompt / hooks，并在 start、continuation 时重读；但默认位置是 `.symphoneer/WORKFLOW.md`。Host poll interval 在 project start 时注册，agent concurrency、`maxTurns`、retry cap 等配置尚未贯穿生产执行。未发现 file watcher / 动态重注册。 | **Partial + Explicit deviations：**repo-owned 配置机制满足；默认路径和动态应用语义不同。 |
| Tracker writes | Core 以 Tracker read / scheduling 为边界；评论、状态、PR 等通常由 Workflow 指示 Agent 经 provider-native tools 完成，不要求新增 Core 写接口。见 [`tracker write boundary`](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L1309-L1321)。 | [`Tracker`](../../src/runtime/tracker/tracker.ts)主要是 `getTask` / `listTasks`；[`GitHubIssuesAdapter`](../../src/runtime/tracker/github-issues.ts)额外提供人工添加 `symphoneer:ready` 标签并回读。没有 Core 评论 / 状态 / PR 写 API。 | **Observed match：**Core 读边界一致；ready-label 是 Symphoneer 扩展。Agent 经 provider tools 完成交付写入的真实路径 **Not verified**。 |
| structured logs / status | 最低要求是携带 issue / session context 的结构化 operator logs；Dashboard / HTTP 状态面是可选扩展且不能成为正确性依赖。见 [`logging`](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L1358-L1415) 与 [`HTTP extension`](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L1458-L1631)。 | [`EventLog`](../../src/runtime/service/event-log.ts)与 [`JsonlEventStore`](../../src/runtime/storage.ts)提供可重放 JSONL domain events；[`HTTP`](../../src/runtime/http.ts)提供 snapshot、event history、SSE、Attempt detail 与控制面。事件有 `taskId` / `attemptId`，但没有证明 operator log 所需的 `issue_identifier` / `session_id` context 或可检索日志 sink。 | **Observed extension：**持久状态与 UI surface 强于最低 HTTP 可选项；**Partial / Not verified：**结构化 operator log 契约未完整证明。 |

## 当前满足的核心定义

- **Observed match：**长期运行 Runtime Host、固定 cadence Tracker 全量刷新、同一项目内串行 poll、失败 backoff。
- **Observed match：**每次执行前重读 Task 并校验 dispatchability；Codex App Server 在隔离 cwd 内启动，Thread / Turn / Attempt 分层记录。
- **Observed match：**repo-owned workflow 配置、Prompt 严格渲染、Workspace hooks、Workspace ownership / recovery / dirty-state 安全。
- **Observed module only：**CoreScheduler 的 ownership、容量、指数 retry、continuation retry 与 reconciliation 语义有确定性测试。
- **Observed extension：**append-only event history、projection、SSE 与人类控制面；这些可观察面不应被解释为自动调度已接通。

## 明确偏离

1. **Workspace identity：**Symphony 是稳定 per-Issue Workspace；Symphoneer 是 per-Issue 目录下的 per-Attempt Git worktree。
2. **派发权：**Symphony poll 后自动 dispatch；Symphoneer 当前 poll 只同步事实，用户命令才启动执行。
3. **continuation：**Symphony 在 Turn 完成后按 Tracker 状态自动继续；Symphoneer 正常 Turn 即结束 Attempt，后续输入才显式续跑。
4. **恢复闭环：**Symphony 的 retry / reconcile / terminal cleanup 属守护进程主循环；Symphoneer 相同语义目前主要停留在 `CoreScheduler` 与测试，生产 retry / delete 是显式命令。
5. **配置生命周期：**Symphoneer 默认 `.symphoneer/WORKFLOW.md`，且只在部分边界重读；并未实现官方要求的完整动态 reload / apply。

这些差异不自动表示产品设计错误；它们表示不能把当前 Symphoneer 声明为对官方 Symphony 核心守护进程的完整 conformant implementation。

## Not verified

- 未运行官方 Elixir reference implementation；官方结论来自 remote ref、固定源码与 SPEC 静态核验。
- 未运行当前 Symphoneer 的真实 GitHub + Git worktree + Codex App Server 长时 Smoke；provider 凭据、网络、真实 Tracker 写入和重启后的端到端行为均未验证。
- 未证明 domain event JSONL 满足官方 operator-log 的全部字段、聚合和检索要求。
- 未审计非 `main` 分支、未合并 PR 或未来发布；它们不是截至核验日的官方 `main` 契约。

## 官方来源

- [`openai/symphony` main commit `f8e8b8a`](https://github.com/openai/symphony/commit/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7)
- [`SPEC.md` at `f8e8b8a`](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md)
- [`f8e8b8a...main` comparison](https://github.com/openai/symphony/compare/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7...main)
- [`elixir/WORKFLOW.md` at `f8e8b8a`](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/WORKFLOW.md)
