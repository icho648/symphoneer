# OpenAI Symphony 与 Symphoneer 的持久化边界

> 核验日期：2026-08-18
> 状态：Research snapshot；只用于解释当前外部契约与本地实现，不自动形成新的产品决定。

## 结论

- **Observed — OpenAI Symphony：** 每项目 `JSONL`、append-only Domain Event 和启动重放**不是**官方 Symphony 的要求。当前官方 SPEC 要求 Orchestrator 持有单一的**内存态**，重启后通过 Tracker 重新轮询并复用保留的 per-Issue Workspace；它明确说不要求持久数据库，也不恢复精确的调度内存态。[SPEC：Goals](https://github.com/openai/symphony/blob/main/SPEC.md#21-goals)、[SPEC：Partial State Recovery](https://github.com/openai/symphony/blob/main/SPEC.md#143-partial-state-recovery-restart)
- **Observed — Symphoneer：** 每项目 `domain-events.jsonl` 和 `RuntimeProjection` 是本项目为多项目 Workbench、历史查询、离线展示和本地重启恢复增加的扩展，不是对官方实现的照抄。[`storage.ts`](../../src/runtime/storage.ts)、[`event-log.ts`](../../src/runtime/service/event-log.ts)、[`projection.ts`](../../src/runtime/projection.ts)
- **判断：** 对当前“本机单 Runtime、单项目单写者、数据量较小”的产品形态，这个实现合理；合理的是**范围受限的事件账本**，不是“所有项目数据都使用 JSONL”。

## 官方 Symphony 实际要求什么

**Observed：** 官方文章把 Issue Tracker 定义为控制面：每个活跃 Issue 对应一个独立 Workspace，Symphony 持续轮询任务并在崩溃或停滞时重新运行 Agent；Issue/交付物是中心，Session 和 PR 不是持久化模型的中心。[OpenAI 官方文章](https://openai.com/index/open-source-codex-orchestration-symphony/)

**Observed：** 当前 SPEC 的恢复模型是：

1. Orchestrator 在进程内保存 `running`、`claimed`、retry 等调度状态；[SPEC：Main Components](https://github.com/openai/symphony/blob/main/SPEC.md#31-main-components)
2. per-Issue Workspace 跨 Run 保留并复用；[SPEC：Workspace Layout](https://github.com/openai/symphony/blob/main/SPEC.md#91-workspace-layout)
3. 重启后清空旧 retry timer、running session 和 live worker 假设，重新从 Tracker 获取 active/terminal Issue，再复用或清理 Workspace；[SPEC：Partial State Recovery](https://github.com/openai/symphony/blob/main/SPEC.md#143-partial-state-recovery-restart)
4. 官方 Elixir prototype 也明确说明 blocked map 只在内存中，重启会清空。[官方 Elixir README](https://github.com/openai/symphony/blob/main/elixir/README.md#how-it-works)

**Observed：** 当前 SPEC 没有定义 `JSONL`、Event Store、Event Sourcing、snapshot/compaction 或“从事件日志精确重建调度状态”的一致性要求。SPEC 中的 agent/runtime event 是运行期回调和可观测性输入，不能据此推导出必须持久化成事件账本。

因此，两种恢复语义不同：

```text
OpenAI Symphony：Tracker 当前事实 + 保留的 Workspace -> 重新开始有用工作
Symphoneer：       Domain Event JSONL -> 重建历史查询投影
                  Tracker / Git / Executor -> 仍负责各自的当前原生事实
```

### Tracker 状态与本地执行状态是两条轴

**Observed：** 官方 SPEC 明确说明 `Todo`、`In Progress` 等 Tracker 状态不同于 Orchestrator 内部的 `Unclaimed`、`Claimed`、`Running`、`RetryQueued`、`Released`。前者由 Tracker 提供并决定 Issue 是否处于 active/terminal 范围；后者只描述本进程是否已经占用 Issue、是否有 Worker、是否等待重试。[SPEC：Issue Orchestration States](https://github.com/openai/symphony/blob/main/SPEC.md#71-issue-orchestration-states)

**Observed：** Symphony 每次调度与运行中 reconciliation 都重新读取 Tracker；active 且满足 required labels 的 Issue 才能运行，Tracker 变为 terminal、non-active 或不再满足路由条件时，本地 Worker 会停止。Orchestrator 本身不要求提供 Ticket 写 API；状态、评论和 PR 等写入通常由 Coding Agent 按 `WORKFLOW.md` 通过 Tracker 原生工具完成。[SPEC：Candidate Selection](https://github.com/openai/symphony/blob/main/SPEC.md#82-candidate-selection-rules)、[SPEC：Tracker Writes](https://github.com/openai/symphony/blob/main/SPEC.md#115-tracker-writes-and-agent-tools-important-boundary)

**Observed：** 官方 Elixir 默认工作流会先把 Tracker Ticket 从 `Todo` 写成 `In Progress`，再开始实现；与此同时，本地 Orchestrator 才把它置为 `Claimed/Running`。因此 `In Progress` 是可跨重启保留的业务状态，`Running` 是进程内执行事实。重启会忘记旧的 `Running/RetryQueued`，然后把仍处于 active Tracker 状态且符合条件的 Issue 重新调度。[官方 `WORKFLOW.md`：Status map](https://github.com/openai/symphony/blob/main/elixir/WORKFLOW.md#status-map)、[SPEC：Partial State Recovery](https://github.com/openai/symphony/blob/main/SPEC.md#143-partial-state-recovery-restart)

**Observed：** 当前官方 GitHub Issues Adapter 只把 GitHub 原生 `open/closed` 映射为 active/terminal；labels 是额外的 dispatch/continue 条件，不是 Orchestrator 的 `Running` 状态。[官方 GitHub Adapter](https://github.com/openai/symphony/blob/main/elixir/lib/symphony_elixir/github/adapter.ex)、[SPEC：Tracker config](https://github.com/openai/symphony/blob/main/SPEC.md#531-tracker-object)

```text
Tracker 轴： open/Todo/In Progress/Human Review/Done  # 业务事实，可持久、可人工修改
Runtime 轴： idle/claimed/running/retrying/blocked    # 执行事实，进程内、重启后重算
```

**判断：** 面向 Web 的模型不应把两条轴压成一个可写 `workflowStatus`。应直接展示 Tracker 状态，并另外叠加当前 Runtime 的 `running/retrying/blocked` 指示；二者都不需要再写进本地项目事件日志。

## Symphoneer 为什么按项目追加和重放

可以把它理解成“每个项目一本流水账”：写入时只在末尾加一笔，启动时顺序读账本，把 Task、Attempt、Workspace、Activity 等的最新状态算进内存 Map。重放的是**读模型**，不是重新执行命令、重新发 GitHub 请求或复活旧进程。

### 1. 项目是自然隔离边界

**Observed：** `ApplicationData.project(projectId)` 为每个项目分配独立根目录，并在其中放置 events、artifacts 和 checkpoint；`DesktopRuntimeHost` 再为每个项目创建独立 `RuntimeService`。[`application-data.ts`](../../src/runtime/host/application-data.ts)、[`desktop-runtime-host.ts`](../../src/runtime/host/desktop-runtime-host.ts)

**判断：** Tracker scope、Task/Attempt ID、Workspace 和运行历史都随项目一起使用。分开账本可以避免一个项目的损坏、迁移或大量历史直接污染其他项目，也使单项目备份与排查简单。官方 Symphony 只规定 per-Issue Workspace，没有规定 Symphoneer 这种多项目 Host 或 per-project Event Store。

### 2. 单写者下 append-only 很简单

**Observed：** `JsonlEventStore` 用进程内 Promise tail 串行写入，每次以 append 模式写一行并 `sync()`；事件 ID 和幂等键重复会被拒绝。[`storage.ts` 17–140](../../src/runtime/storage.ts)

**判断：** 在一个本机 Runtime 独占一个项目文件时，这比引入业务数据库少一层 Schema、迁移和事务管理，同时保留按发生顺序审计的历史。它不适合多个进程并发写同一文件。

### 3. 重放服务于 Workbench 历史投影

**Observed：** `EventLog.start()` 读取全部事件，逐条调用 `RuntimeProjection.apply()`，同时恢复幂等键索引；Projection 保存 Task、Attempt、Workspace、Activity、Session、Review 等当前读模型。[`event-log.ts` 23–63](../../src/runtime/service/event-log.ts)、[`projection.ts` 43–199](../../src/runtime/projection.ts)

**Observed：** 测试覆盖了 Runtime 重启后从同一目录恢复 Task、Attempt、Workspace、Activity、Session 和 Verification 引用；坏 JSON 或未知事件类型会 fail closed。[`runtime.test.ts` 139–210、1068–1097](../../tests/runtime/runtime.test.ts)

**判断：** 这比官方 Symphony 的最低恢复语义更强，目的是让桌面 Workbench 在重启后仍能展示本地执行历史；它不应覆盖 GitHub Issue/PR、Git 或 Executor 的当前原生事实。

### 4. 大内容不进入流水账

**Observed：** 大型检查输出由 `ImmutableArtifactStore` 按内容 SHA-256 写到 `artifacts/`，事件中只保存 `artifactRef`。[`storage.ts` 143–185](../../src/runtime/storage.ts)

**判断：** 这保持事件行较小，也避免重放时反复解析大型日志或 diff。Artifact 是某次执行证据，不是调度状态数据库。

## 什么时候不再合理

**Observed：** 当前实现启动时读取整个 JSONL，并把所有事件、event ID 和幂等键保留在内存；没有 snapshot、compaction 或索引数据库。[`storage.ts` 29–130](../../src/runtime/storage.ts)、[`event-log.ts` 31–60](../../src/runtime/service/event-log.ts)

出现以下任一真实触发器时，应重新评估 SQLite 或 snapshot + compaction，而不是现在预装：

- 单项目事件文件已使启动重放或查询明显变慢；
- 需要跨大量历史做筛选、聚合或分页，而不是只读当前投影；
- 需要多进程/多机器并发写入；
- 需要在线迁移、局部修复或在单行损坏后继续提供降级读取；
- 事件数量使全量内存索引不可接受。

## 证据状态

- **Observed：** 官方 SPEC 当前不要求 JSONL/Event Store，并明确采用 Tracker + Filesystem 的部分恢复。
- **Observed：** 本地源码与确定性测试实现并覆盖了 per-project append/replay 和 immutable artifact 引用。
- **Not verified：** 尚无生产规模数据证明当前方案在大文件、突然断电、磁盘写满、跨版本迁移或长期运行下的恢复质量。
- **Not verified：** 本快照没有把本地测试外推为真实 GitHub、Codex App Server 或安装版应用重启兼容性证明。

## 一手来源

- [OpenAI Symphony SPEC（current `main`，核验于 2026-08-18）](https://github.com/openai/symphony/blob/main/SPEC.md)
- [OpenAI：An open-source spec for Codex orchestration: Symphony](https://openai.com/index/open-source-codex-orchestration-symphony/)
- [OpenAI Symphony Elixir prototype README](https://github.com/openai/symphony/blob/main/elixir/README.md)
- 本地 Symphoneer 当前源码：[`storage.ts`](../../src/runtime/storage.ts)、[`event-log.ts`](../../src/runtime/service/event-log.ts)、[`projection.ts`](../../src/runtime/projection.ts)、[`application-data.ts`](../../src/runtime/host/application-data.ts)
