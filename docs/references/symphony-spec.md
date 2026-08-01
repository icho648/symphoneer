# Symphony SPEC

> External source status: Observed 2026-08-01  
> Project adoption: TypeScript Symphony Core Conformance 以固定 SPEC 为基线  
> Implementation evidence: Not verified

## 固定来源

- [Symphony Service Specification，commit `f8e8b8a`](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md)
- [OpenAI Symphony repository，同一快照](https://github.com/openai/symphony/tree/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7)
- [OpenAI Symphony 文章](https://openai.com/zh-Hans-CN/index/open-source-codex-orchestration-symphony/)

该快照的 SPEC 状态是 `Draft v1`。本项目已决定用 TypeScript 实现 Core Conformance，以该 commit 作为 V1 契约基线。实现前必须重新核对 live SPEC 并记录差异；不能把 `main` 的变化静默视为本项目决定。

## Observed：契约边界

- Symphony 是 tracker reader、scheduler 和 runner。
- Repository-owned `WORKFLOW.md` 保存运行配置、Prompt、Hooks、验证和交接策略。
- Coordination、Execution、Tracker Integration 和 Observability 是不同职责层。
- 成功可以停在 `Human Review` 等工作流交接状态，不要求等于 Tracker 的 `Done`。
- Rich Web UI、多租户控制面、通用 Workflow Engine 和内建 Ticket/PR 业务逻辑不是核心目标。
- 结构化日志是最低可观测要求；人类可读 Dashboard 是可选状态面，不能成为正确性依赖。

## 本项目已决定的扩展

- 固定快照以 Linear 为当前 Tracker 合同；GitHub Issues 是 Symphony Workbench 的 V1 产品决定，不是从该 SPEC 自动继承的已实现能力。
- Workbench Read Model、Verification、ReviewDecision 和 Human Handoff 超出最小 Scheduler/Runner 的职责，其事实源边界由 [`../design-docs/system-boundaries.md`](../design-docs/system-boundaries.md) 固化。
- `WORKFLOW.md` 只在真实 Runtime 实现开始时创建，不提前用占位文档冒充运行契约。

真实兼容性、重试恢复、Workspace 隔离、App Server 协议和安全姿态仍为 `Not verified`。
