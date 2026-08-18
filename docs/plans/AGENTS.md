# Plans — Agent Guidance

本目录保存需要本地恢复上下文的可选计划和跨 Issue 协调索引。GitHub Issue/PR 是增量的目标、范围、验收、进度和验证事实源；Plan 只补充本地恢复、依赖协调和特殊证据边界，不能复制 Issue 或覆盖 [`../core-concepts/`](../core-concepts/) 与 [`../decisions/`](../decisions/) 的当前规则。

## 当前计划

| 计划 | 状态 | 用途 | 事实源 |
|---|---|---|---|
| [issue-47.md](active/issue-47.md) | Active | #47 本地恢复、备份与 Smoke 索引 | Issue #47、Draft PR 与本地 Git |

已完成的 V1 历史协调计划保存在 [symphoneer-v1.md](completed/symphoneer-v1.md)，不再作为当前进度入口。

## 何时使用

创建或更新 active plan：

- Issue 不完整，或不能承载本地执行约束。
- 需要跨轮恢复、记录危险操作、外部资源重试或多个本地验证阶段。
- 需要维护跨 Issue 的依赖、Review Gate 或整体证据索引。

不创建或维护重复的 active plan：

- 关联 Issue 已包含目标、范围、非目标、依赖、验收和证据要求，且可由 Issue、PR 和提交历史恢复。
- 单个 Issue 的普通实现、代码审查、事实核对、文档修订和导航修复。

## 不可省略的性质

计划必须：

- 记录本地恢复所需的上下文、路径、假设、关键产物和安全恢复方式；通过链接引用 Issue/PR，不复制其目标和验收。
- 只在跨 Issue 决定、恢复入口、失败恢复约束或证据边界变化时更新，不记录单个 Issue 的执行进度。
- 说明用户结果、验证命令/预期/失败判定，以及每一步的输入、产物和下一步。

跨 Issue 协调索引不承担每个 Issue 的 runbook；具体命令、工作目录、预期结果和失败标准留在 Issue/PR 或任务专用计划中。

## 必需章节

需要恢复的 active plan 至少包含：

1. 目标与上下文
2. 当前进度、决定和发现
3. 工作步骤与产物
4. 验证与验收
5. 恢复、依赖和备注

## 维护规则

- 遵循根 `AGENTS.md` 的实时事实和 Issue/PR 写回规则；未执行的测试、Smoke 或外部集成保持 `Not verified`。
- 新增或移动计划时更新本文件；目标行为及必需验证完成后移入 `completed/`，废弃计划也移出 `active/`，不保留过期导航入口。

这些规则吸收 [Using PLANS.md for multi-hour problem solving](https://developers.openai.com/cookbook/articles/codex_exec_plans) 与 [`../research/2026-08-02-anthropic-long-running-agent-harness.md`](../research/2026-08-02-anthropic-long-running-agent-harness.md) 中适合本项目的增量任务、恢复和可验证验收习惯。
