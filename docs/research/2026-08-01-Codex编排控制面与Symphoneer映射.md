# Codex 编排控制面与 Symphoneer 映射

整理日期：2026-08-01  
来源：[Codex 进阶指南：作为 Multi-Agent 编排控制平面](https://x.com/riba2534/status/2082916383248252976)

## 证据状态

- **Observed：** 原文对 Codex App、CLI、IDE、Task、Subagent、Worktree、Remote SSH、Handoff、App Server 和常见编排拓扑的整理。
- **Not verified：** 原文涉及的当前工具名称、参数、跨主机可见性、权限继承和 Handoff 行为；实现前必须以当前官方 Schema、CLI 帮助和本地 Smoke 为准。
- 本文**不是** Codex 官方规范。同 Thread 的并发、FIFO、steer 与跨进程风险以
  [`2026-08-10-codex-app-server-concurrency.md`](2026-08-10-codex-app-server-concurrency.md)
  为准；规范性对象边界以 [`../core-concepts/product-boundary.md`](../core-concepts/product-boundary.md)
  与 [`../references/codex-app-server.md`](../references/codex-app-server.md) 为准。

## 原文最值得保留的结论

Codex 提供可组合的运行与控制原语（发现 → 派工 → 等待 → 独立验证 → Steering / Handoff → Review），
重点是把任务、执行环境、运行事件、验证结果和人工决策分开，而不是“多开几个 Agent”。

## 对象模型：不要把 Codex 对象当成业务对象

| Codex 概念 | Symphoneer 映射 |
|---|---|
| Project / Host | `Workspace` 来源与执行目标 |
| Task / 持久 Thread | `threadId` 关联到一次 `Attempt`，不替代业务 `Task` |
| Turn / Item | Run 内过程与观察单元，不是业务状态 |
| Subagent | V1 不单独建业务实体 |
| Worktree | `Workspace` 的一种实现 |
| Handoff | 迁移执行位置，不是语义责任交接 |
| Automation | 触发器，不是业务 DAG |

## 仍值得保留的控制词汇（尚未全进 design-docs）

- `Steering` ≠ `Interrupt`：追加方向 vs 终止当前 Turn。
- `Detached Review`：Reviewer 与 Generator 上下文隔离。
- `wait-any` ≠ `wait-all`：上游“完成”不等于前置条件满足。
- `outputSchema` / 结构化 Artifact / 独立 Verifier：把完成声明变成可判定结果。
- Workspace 必须记录路径、来源、宿主机、分支和隔离方式。

## 明确不吸收

- 不因原文拓扑清单做成通用 Multi-Agent Workflow Engine。
- 不在 V1 同时支持多个 Runtime / Tracker 类型 / 模型 Adapter。
- 不让 MCP 取代 App Server 运行事件或成为业务状态库。

## 实现前核验清单

- App Server JSON Schema：Thread、Turn、Item、事件和 Review 方法。
- Worktree 的分支占用、未提交改动和 Handoff 约束。
- Local / Remote SSH / Cloud 可用范围与权限继承。
- 等待工具是 wait-any 还是 wait-all；超时、失败与 cursor 表达。
- `outputSchema`、独立 Review 与结构化产物在当前版本是否稳定。

## 一手核验入口

- [Codex 文档](https://developers.openai.com/codex/)
- [Codex App Server](https://github.com/openai/codex/tree/main/codex-rs/app-server)
- [Codex Worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees)
