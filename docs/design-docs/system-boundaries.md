# System Boundaries

> Decision status: Accepted  
> Implementation evidence: Not verified

本文件固化 V1 对象、权威、证据、控制和信任边界。它不定义数据库 Schema，也不声称这些对象已实现。

## 对象与权威

| 对象 | 权威来源 | Workbench 的责任 |
|---|---|---|
| Tracker Task | GitHub Issues 的 Issue 身份、意图、状态、标签和协作记录 | 按原生 ID 投影并对账，不创建竞争性 Task 真相 |
| Eligibility / Dispatch / Retry / Reconciliation | Symphony Runtime 的活调度状态 | 展示原因和受控操作，不用 UI 状态代替 Runtime |
| Attempt | Symphony Runtime 的当前生命周期；Workbench 的历史投影 | 为每次尝试分配稳定 ID，持久化所观察的转换与来源 |
| Workspace | Symphony Runtime 的路径、分支、所有权与回收规则 | 保留引用，检测竞争所有者或不一致 |
| Codex Thread / Turn / Item | Codex App Server | 保留原生标识和必要事件，不把 Turn 完成当成验收 |
| Diff / Commit / Branch | Git | 保留引用和观察到的版本，不伪造变更真相 |
| Pull Request / Checks / Review / Merge | GitHub 原生对象与人 | 投影状态和深链，不执行最终 Merge |
| Verification | `WORKFLOW.md` 声明的项目原生检查，以 Workbench 独立运行产生的 artifact 为结果证据 | 在 Codex Turn 后独立运行、记录命令、退出状态、必要输出和对应版本 |
| ReviewDecision | Human Review | 记录决定、依据、责任人和下一动作 |
| Trace / Span / Evaluation | Phoenix 中的诊断副本 | 保留关联 ID；Phoenix 不可用时仍继续核心流程 |
| Historical Projection | Workbench 的 append-only JSONL 和不可变 artifact | 支持重放、查询和 UI，不覆盖上述原生权威 |

Web、MCP 和后续 Electron 只是访问面，不是事实源。Harness 是本仓库的开发基建，不进入 Workbench 产品领域对象。

## 投影与对账

- JSONL 只追加带稳定 ID、来源、时间和 Schema 版本的事件；大输出、检查日志和差异作为不可变 artifact 被引用。
- 重放只重建 Workbench 历史投影，不会重放外部写操作，也不会把历史投影升级为当前 Tracker、Runtime 或 Git 状态。
- 对账时重新读取原生权威；如果与投影不一致，显示来源差异并停止危险推进，不静默覆盖。
- Phoenix 接收的 Trace 是可丢失的诊断数据；发送失败不改变 Task、Attempt、Verification 或 ReviewDecision。

## 验证与决定权

1. `Runtime Event` 只能证明某个运行事件被观察到。
2. `Agent Statement` 和 Codex Turn 完成都不是独立验证器。
3. `Verification` 由 Workbench 在 Agent 执行后独立运行 `WORKFLOW.md` 的 `workbench.verification` 所引用的项目命令。
4. 未运行、超时、无对应版本或缺少 artifact 的检查不能标记为通过。
5. `Human Review` 保留验收、继续修改、Follow-up、人工接管、Merge 和 Close 的最终决定权。

缺少匹配证据时必须显示 `Not verified`，不能用文档、Mock、构建成功、Trace 或 Agent 完成声明替代真实 Smoke 和人工判断。

## 受控操作

- Web 和 MCP 复用同一本地服务、契约和授权判断。
- MCP V1 可查询 Task / Attempt，也可受控地 refresh、dispatch、pause、retry 和 respond to intervention。
- 每个变更操作都必须有目标版本或前置条件、幂等键、当前状态复核和 Host 确认。
- MCP 不提供 Commit、Merge、权限扩大或 Harness 自动修改。任何越过该边界的能力都需要新的人工决定。

## 可靠性与信任边界

- 同一 Task 的并发 Attempt、Workspace 和活跃 Codex Turn 必须有明确互斥或所有权规则。
- Retry、Cancel、Timeout、进程重启、失联和人工接管必须能对账；调度重试不等于业务 exactly-once。
- Issue、第三方页面、日志和 Agent 输出属于不可信输入，不能成为高优先级项目指令。
- Token、代码、日志和运行证据只暴露给完成当前动作所需的最小边界；不得把凭据写入 JSONL、artifact 或 Phoenix。
- Workspace 隔离不是 sandbox、审批或路径校验的替代品。

## 实施检查点

上述边界是已接受的设计，下列行为在真实实施与 Smoke 前全部为 `Not verified`：

- TypeScript Symphony Core 与固定 SPEC 的兼容性。
- GitHub 标签门禁、写回、限流和最终一致性。
- Codex App Server 的 Schema、生命周期、审批、暂停、恢复和人工接管。
- JSONL 的原子追加、损坏检测、重放与 Schema 升级。
- Web / MCP 共用状态、幂等保护与 Host 确认。
- Phoenix 失败隔离与脱敏。

实施和验收路径见 [`../exec-plans/active/symphony-workbench-v1.md`](../exec-plans/active/symphony-workbench-v1.md)。
