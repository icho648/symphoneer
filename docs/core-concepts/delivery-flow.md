# Autonomous Delivery Flow

> Decision status: Accepted
> Implementation evidence: Partial — deterministic Runtime, Scheduler, Workspace and Worker tests pass; real GitHub/Codex/Desktop Host Smoke remains `Not verified`

## 用户结果

个人开发者把符合 `.symphoneer/WORKFLOW.md` 资格规则的 GitHub Issue 交给 Runtime。Tracker 全量同步后的生产 tick 自动调度任务，在稳定的 per-Issue Workspace 中运行配置的 Executor，并持续使用同一 Attempt Worker / Session 处理顺序 Turn，直到 Tracker 进入 Review、终态、不可路由，或需要重试与人工接管。

## 前置条件

- Issue 是目标、范围和验收事实源，原生状态属于 `active_states`，标签满足 `.symphoneer/WORKFLOW.md` 的资格规则。
- 受管项目的 `.symphoneer/WORKFLOW.md` 有效；根 `WORKFLOW.md` 不参与加载。
- 用户拥有仓库、GitHub 写入和最终 Review 权限；写入不可用时 Agent 报告 blocker。

## 用户流程

1. Runtime 全量同步 Tracker，reload `.symphoneer/WORKFLOW.md`，reconcile 持久化状态，处理到期 retry，再按稳定顺序和并发限制 dispatch。
2. Runtime 为 Issue 使用稳定的 `workspace:<task-id>`、`issue-<number>` 路径和 `symphoneer/issue-<number>` 分支；新 Attempt 只重新取得该 Workspace 的租约。
3. Attempt 打开一个 Worker。Worker 在 Workspace cwd 启动 Executor 进程，并在多个顺序 Turn 中复用原生 Session；上下文来源见 [`executor-context.md`](executor-context.md)。
4. 每个 Turn 后同步 Session 并重读 Issue。仍 eligible 时继续；`symphoneer:review`、终态或不可路由时停止。
5. `maxTurns` 只结束当前 Attempt；仍 eligible 时约一秒后在同一 Workspace 以新 Attempt、新 Worker 和新 Session 继续。失败使用有上限的指数退避。两类自动续跑都计入 `agent.max_attempts`（默认 `3`）；达到上限后保留 Workspace、标记阻塞并等待人显式重新尝试。每次显式重试只放行一个额外 Attempt。
6. Tracker 的 `symphoneer:review` 才把本地 Task 投影推进到 `In review`；Turn 或 Attempt 成功本身不是验收。
7. 人可以请求 Handoff。Runtime 等当前 Turn 结束，关闭 Worker并保留 Workspace，然后把控制权交给 Codex。
8. 人把控制权交还给自动化时，Runtime 先等待 Codex 停止工作，再确认工作区仍在预期分支和提交上、内容没有被意外替换、也没有未提交修改。检查通过并重新锁定工作区后，自动执行才会继续；否则保留现场并提示人工处理。
9. 删除 Attempt 只会删除这次执行记录，不会删除 Issue 的工作区。工作区会留给后续重试；只有 Issue 进入终态，或测试环境明确要求清理时，Runtime 才会在安全检查通过后删除它。

## 必须区分

| 对象 | 用户要看到的内容 |
|---|---|
| Task | Issue 身份、Tracker 状态、标签和资格 |
| Attempt | 序号、开始原因、控制者、结果和 retry / reconciliation |
| Workspace | 稳定路径、分支、HEAD、fingerprint 和当前租约 |
| Worker / Process | 一个 Attempt 的 Executor PID、版本和关闭结果 |
| Session / Turn | Provider 上下文和每轮活动；Turn 完成不等于验收 |
| Operator Log | 操作、关联 ID、PID、耗时、outcome 和 error kind；不含 Prompt、Token、源码或 Provider payload |
| ReviewDecision | 人基于 Tracker、Git、检查和 PR 证据作出的最终决定 |

## 出错和重启后怎么处理

- Agent 执行或 GitHub 同步失败后，系统会稍后重试。每次重试前都会重新读取 Issue，避免按过期状态继续工作。
- 同一任务连续自动执行的次数受 `agent.max_attempts` 限制，默认最多三次。达到上限后，即使 Runtime 重启也不会自动继续；需要人先确认工作区安全，再手动放行一次新的执行。
- Runtime 重启后会从记录恢复现场。如果某次自动执行仍显示运行中，但对应的 Agent 进程已经不存在，系统会把它标记为“因重启取消”；由 Codex 接管的任务仍保持锁定，不会被自动化抢回。
- Issue 不再处于自动处理范围、但也没有结束时，系统停止写入并保留工作区。只有 Issue 进入终态后，系统才会尝试清理工作区。
- 删除工作区前，系统会检查当前分支、提交和未提交修改。任何一项不符合预期都会保留现场并提示人工处理，不会自动丢弃或隐藏改动。
- 修改运行配置后，只有新配置有效时才会切换。无效更新不会影响正在执行的任务，系统继续使用上一份有效配置；首次启动时配置无效则拒绝启动。

## 什么算验证完成

- 本地自动化测试只能证明调度、工作区、Agent 执行、人工接管和日志等本地行为符合约定，不能证明外部服务已经正常接通。
- GitHub、所选 Agent 和桌面宿主是否真正可用，必须分别在真实环境完成 Smoke 测试。
- Agent 完成一轮回复不等于任务交付完成。合并代码和关闭 Issue 始终由人根据 Tracker、代码和检查结果决定。
