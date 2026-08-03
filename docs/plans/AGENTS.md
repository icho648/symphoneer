# Plans — Agent Guidance

本目录保存复杂工作的自包含、可恢复、持续更新的执行规格。Plan 不是产品路线图或静态愿望清单，也不能覆盖 [`../design-docs/`](../design-docs/) 中的确认决定。

## 当前计划

| 计划 | 状态 | 当前停点 | Implementation evidence |
|---|---|---|---|
| [symphoneer-v1.md](active/symphoneer-v1.md) | Active | 分层 `AGENTS.md` 文档 Harness 已通过本地检查；下一增量是 Phase 3 / Issue #14 | Partial — Issue #13 local Core；真实 Adapter / Runtime Not verified |

当前没有 completed plan。计划完成或废弃后才创建 `completed/` 并移动文件。

## 何时使用

以下情况创建或更新 active plan：

- 预计持续数小时、跨多个文件或需要多个验证阶段。
- 重大重构、应用实现、迁移或存在关键技术未知。
- 中断后需要由不了解上下文的 Agent 仅凭工作树和计划继续。

错别字、小型文档修订、单个事实核对和导航修复不创建 plan。

## 不可省略的性质

每个 plan 必须：

- **自包含：** 定义术语、当前上下文、涉及路径和必要假设，不依赖聊天记录或人的记忆。
- **持续更新：** 每个停点更新进度、发现、决定和下一步。
- **结果导向：** 说明用户最终能做什么，以及如何观察它真实工作。
- **可验证：** 给出准确命令、工作目录、预期结果和失败判定。
- **可恢复：** 说明重复执行、失败重试、危险步骤和安全恢复方式。
- **增量化：** 每一步都有明确输入、产物、验收和下一步。

## 必需章节

active plan 必须依次包含：

1. `Purpose / Big Picture`
2. `Progress`
3. `Surprises & Discoveries`
4. `Decision Log`
5. `Outcomes & Retrospective`
6. `Context and Orientation`
7. `Plan of Work`
8. `Concrete Steps`
9. `Validation and Acceptance`
10. `Idempotence and Recovery`
11. `Artifacts and Notes`
12. `Interfaces and Dependencies`

## 维护规则

- 开始或恢复时先检查工作树、最近 Diff、当前 active plan 和本增量事实源。
- 每次只推进一个可判定增量；先写完成条件，再实施并运行对应检查。
- 停止时更新 Progress、命令结果、未完成工作和唯一明确下一步；计划变化同步写入 Discoveries 与 Decision Log。
- 交接状态记录当前路径、版本或分支、关键产物、失败原文、重试入口和不可重复的外部动作。
- 未执行的测试、Smoke 或外部集成保持 `Not verified`。
- 只有目标行为和必需验证完成后才移入 `completed/`；不把过期 active plan 留作导航入口。
- 新增、移动或完成计划时更新本文件。

这些规则吸收 [Using PLANS.md for multi-hour problem solving](https://developers.openai.com/cookbook/articles/codex_exec_plans) 与 [`../research/2026-08-02-anthropic-long-running-agent-harness.md`](../research/2026-08-02-anthropic-long-running-agent-harness.md) 中适合本项目的增量任务、恢复和可验证验收习惯。
