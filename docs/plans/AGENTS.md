# Plans — Agent Guidance

本目录保存需要本地恢复上下文的可选执行伴随物。Issue-driven 增量的目标、范围、依赖、验收和授权以 GitHub Issue 为准；Plan 不是第二份 Issue，也不能覆盖 [`../design-docs/`](../design-docs/) 中的确认决定。

## 当前计划

| 计划 | 状态 | 用途 | 事实源 |
|---|---|---|---|
| [symphoneer-v1.md](active/symphoneer-v1.md) | Active | V1 跨 Issue 协调索引 | 关联 GitHub Issue/PR/依赖与本地 Git |

当前没有 completed plan。计划完成或废弃后才创建 `completed/` 并移动文件。

## 何时使用

以下情况创建或更新 active plan：

- 没有完整的 GitHub Issue，或 Issue 不能承载本地执行约束。
- 需要跨多轮中断恢复、记录危险操作、外部资源重试或多个本地验证阶段。
- 需要维护 V1 这类跨多个 Issue 的依赖、Review Gate 和整体证据索引。

以下情况不创建或维护重复的 active plan：

- 关联 Issue 已包含目标、范围、非目标、依赖、验收和证据要求，且工作可由 Issue、PR 和提交历史恢复。
- 单个 Issue 的普通实现、代码审查、单个事实核对和导航修复。

错别字、小型文档修订、单个事实核对和导航修复不创建 plan。

## 不可省略的性质

每个 active plan 必须：

- **自包含：** 记录本地恢复所需的上下文、路径和必要假设；Issue-driven 计划通过链接引用 Issue，不复制其目标和验收。
- **按需更新：** 只在跨 Issue 决定、恢复入口、失败恢复约束或证据边界变化时更新；单个 Issue 的执行进度不复制到这里。
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

- 开始或恢复时先检查工作树、当前分支、关联 Issue/PR 和本增量事实源；只有存在 active plan 时才读取它。
- Issue、PR、依赖、assignee、标签、评论、分支和测试结果都是实时事实；不得把计划中的缓存文字当作当前状态，外部写入前也必须重新读取。
- 每次只推进一个可判定增量；先写完成条件，再实施并运行对应检查。
- 停止时优先更新 Issue/PR 的进度、命令结果和下一步；active plan 只更新跨 Issue 决策、恢复入口、失败原文和不可重复的本地/外部动作。
- 交接状态记录当前路径、版本或分支、关键产物、失败原文、重试入口和不可重复的外部动作；不把 Issue 内容复制进计划。
- 未执行的测试、Smoke 或外部集成保持 `Not verified`。
- 只有目标行为和必需验证完成后才移入 `completed/`；不把过期 active plan 留作导航入口。
- 新增、移动或完成计划时更新本文件。

这些规则吸收 [Using PLANS.md for multi-hour problem solving](https://developers.openai.com/cookbook/articles/codex_exec_plans) 与 [`../research/2026-08-02-anthropic-long-running-agent-harness.md`](../research/2026-08-02-anthropic-long-running-agent-harness.md) 中适合本项目的增量任务、恢复和可验证验收习惯。
