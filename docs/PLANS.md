# ExecPlans

本文定义 Symphoneer 中 ExecPlan 的编写和维护契约。ExecPlan 是复杂工作的自包含、可恢复、持续更新的执行规格；它不是产品路线图，也不是静态愿望清单。

## 何时使用

以下情况创建 ExecPlan：

- 预计持续数小时、跨多个文件或需要多个验证阶段的任务。
- 重大重构、应用实现、迁移或存在关键技术未知的工作。
- 中断后需要由不了解上下文的 Agent 仅凭工作树和计划继续的任务。

错别字、小型文档修订、单个事实核对和索引修复不创建 ExecPlan。

## 文件位置

- 进行中的计划：[`exec-plans/active/`](exec-plans/active/)
- 完成并保留验证证据的计划：[`exec-plans/completed/`](exec-plans/completed/)
- 没有满足本契约的计划时，`active/` 应明确显示为空。

## 不可省略的性质

每个 ExecPlan 必须：

- **自包含：** 定义术语、当前上下文、涉及路径和必要假设，不依赖聊天记录或人的记忆。
- **持续更新：** 每个停点更新进度、发现、决定和下一步。
- **结果导向：** 说明用户最终能做什么，以及如何观察它真实工作。
- **可验证：** 给出准确命令、工作目录、预期结果和失败判定。
- **可恢复：** 说明重复执行、失败重试、危险步骤和安全恢复方式。
- **增量化：** 把工作拆成可独立观察和验收的小步，每一步都有明确输入、产物和下一步。

## 必需章节

一个 active ExecPlan 至少包含：

1. `Purpose / Big Picture`：用户价值和可观察结果。
2. `Progress`：带时间的完成、进行中和剩余工作。
3. `Surprises & Discoveries`：意外行为及其证据。
4. `Decision Log`：决定、理由、日期和责任人。
5. `Outcomes & Retrospective`：结果、缺口和经验。
6. `Context and Orientation`：当前结构、关键文件和术语。
7. `Plan of Work`：按顺序描述最小必要改动。
8. `Concrete Steps`：准确命令、工作目录和预期输出。
9. `Validation and Acceptance`：可由人或独立检查判定的行为。
10. `Idempotence and Recovery`：重跑、回滚和失败恢复。
11. `Artifacts and Notes`：证明结果所需的最小日志、Diff 或输出。
12. `Interfaces and Dependencies`：必须存在的契约与采用理由。

## 维护规则

- 开始实施前补齐上下文和验收，不把关键决定留给执行者猜测。
- 开始或恢复时先检查工作树、最近 Diff 和 active ExecPlan，只加载当前增量需要的事实源；不要依赖上一段会话仍在上下文中。
- 每次只推进一个可判定增量；先写明本步完成条件，再实施并运行对应检查。
- 每次停止时更新 `Progress`、已运行命令及结果、未完成工作和唯一明确的下一步；发现与原计划不符时同时更新 `Surprises & Discoveries` 与 `Decision Log`。
- 交接状态必须足以让新的 Agent 从仓库恢复：记录当前路径、版本或分支、关键产物、失败原文、重试入口和不可重复的外部动作。
- 未执行的测试、Smoke 或外部集成必须写成 `Not verified`，不能用计划中的命令冒充结果。
- 只有目标行为已经产生且所需验证完成后，才把计划移入 `completed/`。
- 计划完成或废弃时记录结果和原因，不把过期 active plan 留作导航入口。

这些规则同时吸收 [Using PLANS.md for multi-hour problem solving](https://developers.openai.com/cookbook/articles/codex_exec_plans) 与 [`2026-08-02-anthropic-long-running-agent-harness.md`](research/2026-08-02-anthropic-long-running-agent-harness.md) 中适合本项目的上下文整理、增量任务、进度交接和可验证验收习惯。Planner、Evaluator 和多 Agent Harness 不因此成为 Symphoneer 产品功能。
