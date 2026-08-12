# Autonomous Delivery Flow

> Decision status: Accepted
> Implementation evidence: Partial — deterministic Runtime, Scheduler, Workspace and Worker tests pass; real GitHub/Codex/Desktop Host Smoke remains `Not verified`

## 用户结果

个人开发者把带 `symphoneer:ready` 的 GitHub Issue 交给 Runtime。Tracker 全量同步后的生产 tick 自动调度任务，在稳定的 per-Issue Workspace 中运行 Codex，并持续使用同一 Attempt Worker / Thread 处理顺序 Turn，直到 Tracker 进入 Review、终态、不可路由，或需要重试与人工接管。

## 前置条件

- Issue 是目标、范围和验收事实源，原生状态属于 `active_states`，标签满足 `WORKFLOW.md` 的资格规则。
- 仓库根 `WORKFLOW.md` 有效；缺失时兼容 `.symphoneer/WORKFLOW.md` 并记录弃用事件。
- 用户拥有仓库、GitHub 写入和最终 Review 权限；写入不可用时 Agent 报告 blocker。

## 用户流程

1. Runtime 全量同步 Tracker，reload `WORKFLOW.md`，reconcile 持久化状态，处理到期 retry，再按稳定顺序和并发限制 dispatch。
2. Runtime 为 Issue 使用稳定的 `workspace:<task-id>`、`issue-<number>` 路径和 `codex/issue-<number>` 分支；新 Attempt 只重新取得该 Workspace 的租约。
3. Attempt 打开一个 Worker。Worker 在 Workspace cwd 启动一个 App Server 进程，并在多个顺序 Turn 中复用 Thread。
4. 每个 Turn 后同步 Session 并重读 Issue。仍 eligible 时继续；`symphoneer:review`、终态或不可路由时停止。
5. `maxTurns` 只结束当前 Attempt；约一秒后在同一 Workspace 以新 Attempt、新 Worker 和新 Thread 继续。失败使用有上限的指数退避。
6. Tracker 的 `symphoneer:review` 才把本地 Task 投影推进到 `In review`；Turn 或 Attempt 成功本身不是验收。
7. 人可以请求 Handoff。Runtime 等当前 Turn 结束，关闭 Worker并保留 Workspace，然后把控制权交给 Codex。
8. Return to Automation 先确认 Thread idle，再验证 HEAD、fingerprint 和 dirty state并重新获取租约；成功后才恢复 Worker/Thread 和 Symphoneer 控制权。
9. Attempt 历史可以删除，但稳定 Workspace 不随 Attempt 删除。只有 Tracker 终态 reconcile 或 fixture cleanup 执行安全释放。

## 必须区分

| 对象 | 用户要看到的内容 |
|---|---|
| Task | Issue 身份、Tracker 状态、标签和资格 |
| Attempt | 序号、开始原因、控制者、结果和 retry / reconciliation |
| Workspace | 稳定路径、分支、HEAD、fingerprint 和当前租约 |
| Worker / Process | 一个 Attempt 的 App Server PID 和关闭结果 |
| Thread / Turn | Provider 上下文和每轮活动；Turn 完成不等于验收 |
| Operator Log | 操作、关联 ID、PID、耗时、outcome 和 error kind；不含 Prompt、Token、源码或 Provider payload |
| ReviewDecision | 人基于 Tracker、Git、检查和 PR 证据作出的最终决定 |

## 失败、重试和对账

- Worker 或 Tracker 失败进入 Scheduler retry；到期重试不复用旧 `expectedUpdatedAt`，而是重新读取 Tracker。
- Runtime 启动时重放 Attempt / Workspace 历史。失去 Worker 的 Symphoneer Attempt 标记为 `canceled_by_reconciliation`；Codex-owned Attempt 保持锁定。
- Issue 离开 active 但未终态时停止自动写入并保留 Workspace；终态才请求安全 cleanup。
- cleanup 的 HEAD、fingerprint 或 dirty-state 校验失败时保留现场并报告 blocker，不 force、stash、reset 或 clean。
- 活跃配置 reload 失败时保留 last-known-good；已打开 Worker 使用启动时快照。首次配置无效则启动失败。

## 验收边界

- 确定性测试证明本地状态机、Workspace、Worker、Runtime tick、交接和日志契约。
- 真实 Smoke 证明 GitHub、Codex 和 Desktop Host 集成；模型随机输出不能证明 Scheduler 状态机。
- 人保留 Merge / Close 最终权力；Runtime、Agent 或文档不得自动把成功 Turn 升级为完成声明。
