# Symphoneer 面向个人开发者的产品机会

> 核验日期：2026-08-14  
> 状态：Research input；不自动形成产品决定或实现授权

## 核心判断

个人开发者的主要瓶颈不是继续增加调度能力，而是注意力与交付判断：什么时候需要介入、应该检查什么、如何把反馈送回原执行上下文、失败后能否恢复。

## 外部信号

- **Observed：** Claude Code Hooks 把等待输入、权限请求和完成通知列为原生生命周期场景；Remote Control 也以远程查看、响应和推送通知为主要能力。[Hooks](https://code.claude.com/docs/en/hooks-guide) · [Remote Control](https://code.claude.com/docs/en/remote-control)
- **Observed：** Cursor Mobile 的公开定位包含 Agent 完成、需要输入和可 Review 时的推送通知。[Cursor Mobile](https://cursor.com/changelog/ios-mobile-app)
- **Observed：** GitHub 的 Coding Agent 流程把 PR、检查、Review 活动、Session 历史和人工批准放在交付边界；Agent 完成工作后仍由人 Review。[GitHub third-party coding agents](https://docs.github.com/en/copilot/concepts/agents/about-third-party-coding-agents) · [Responsible use](https://docs.github.com/en/copilot/responsible-use/agents)
- **Observed：** OpenAI Symphony 已覆盖 Tracker 轮询、Workspace 隔离、重试、并发和可选状态面，因此重复建设通用 Workflow / Scheduler 的边际价值较低。[Symphony SPEC](https://github.com/openai/symphony/blob/main/SPEC.md)

## 候选机会

| 顺序 | 机会 | 最小产品切片 | 判断 |
|---|---|---|---|
| 1 | Attention Center | 只聚合需要审批、失败、等待 Review、Workspace 异常四类事件，并发系统通知 | 高价值、低到中成本；复用现有 Runtime 事件和 Web |
| 2 | Evidence / Review Card | 汇总验收项、Diff、检查结果、风险、分支与 PR，不生成综合质量分 | 高价值、低成本；直接强化 Human Review |
| 3 | Feedback to same Session | 把 CI / Review 意见作为新 Turn 送回原 Attempt 上下文 | 高价值、中成本；先支持人工触发 |
| 4 | Executor fallback | Claude Code 接入后允许用户选择“使用另一 Executor 重试”，生成新 Attempt 并保留历史 | 中高价值；无需自动路由或 Provider 平台 |
| 5 | Doctor / Recovery | 解释不可调度原因、断线 Attempt、卡住审批和 retained Workspace，并给出安全动作 | 中高价值；可先做只读诊断 |

## 需要先验证的假设

- **Proposed：** 无 Tracker 的临时任务可能降低个人用户的启动成本，但会改变当前 `Tracker Task` 作为入口和事实源的产品边界；先用访谈或手工原型验证，不直接实现。
- **Proposed：** 手机查看与审批对使用 CC Switch / 自定义 Provider 的用户可能有差异化，但远程访问和授权成本明显高于本地通知，应后置。

## 不建议近期投入

- 完整 TUI：与现有 Web / Codex App 重叠；轻量 CLI 只作为查询和自动化入口。
- 第三个 Tracker：没有真实 Tracker 需求前不建设通用平台。
- 自动 Executor 路由、通用 Workflow Builder、Phoenix 评估体系：对当前个人用户闭环不是主要阻塞。

