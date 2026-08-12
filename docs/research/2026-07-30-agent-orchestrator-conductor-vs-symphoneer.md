# Agent Orchestrator、Conductor 与 Symphoneer

核实日期：2026-07-30

> **Decision（2026-08-01）：** 竞品事实对比仍作输入；将 Symphoneer 做成 Evidence/Harness
> Sidecar 的旧建议已被取代。当前以 Symphony Runtime 为核心的交付工作台，见
> [`product-boundary.md`](../design-docs/product-boundary.md)。

## 对象确认

- 开源 Agent Orchestrator：[`Untrivial-ai/agent-orchestrator`](https://github.com/Untrivial-ai/agent-orchestrator)（旧 `ComposioHQ/agent-orchestrator` 已重定向）
- 闭源 Conductor：[`conductor.build`](https://www.conductor.build/)
- Symphoneer：本地产品边界见 design-doc；本文不证明任何集成已实现

## 对比

| 维度 | Agent Orchestrator | Conductor | Symphoneer（当前定位） |
|---|---|---|---|
| 产品形态 | 开源 Agent IDE + 本地 daemon | 闭源 macOS App + Cloud API | 本地优先 Coding Agent 交付工作台 |
| 核心模型 | Project → Issue → Session → Worktree → PR | Project → Workspace → Chat → Review | Tracker Task → Attempt → Workspace → Verification → Human Review |
| Agent | 多终端 Adapter + Orchestrator/Worker | Claude Code / Codex / Cursor / OpenCode | V1 仅 Codex App Server |
| Task Source | GitHub / GitLab / Linear / Prompt | 手工 Workspace，可从 Issue/PR/Branch 起 | V1：GitHub Issues Tracker |
| 隔离 | Worktree / Clone Adapter | 每 Workspace 一个 worktree | Attempt 级 Workspace / worktree |
| 自动化 | CI/Review 可自动回送，甚至可 Merge | 更偏人工工作台；有 Cloud API | Manual-first、Human authority |
| MCP | 非主要产品接口 | 未作主要边界 | 查询与受控命令，非事件总线 |

## 不能再主打的差异

多 Agent 看板、每 Agent 一 worktree、Issue 派发、终端/Diff/PR/CI 面板、多 Adapter——这些已被 AO / Conductor 覆盖得更完整，不能当作 Symphoneer 的主叙事。

## 仍值得验证的差异（研究输入，非当前产品承诺）

一手资料未显示 AO / Conductor 把下列作为核心交付模型：

1. 记录某次 Run 实际生效的 Harness 修订（`AGENTS.md` / Skills / 验证命令等）
2. 完成声明逐项映射到独立、可重复验证证据；无证据时显式 `Not verified`
3. 重复失败聚合为可追溯 Finding，并由人决定是否升级为 Harness 改进

## 一手来源

- AO：[README](https://github.com/Untrivial-ai/agent-orchestrator) · [Architecture](https://github.com/Untrivial-ai/agent-orchestrator/blob/main/docs/architecture.md) · [Review loop](https://aoagents.dev/docs/guides/review-loop)
- Conductor：[Docs](https://www.conductor.build/docs) · [Workspaces](https://www.conductor.build/docs/concepts/workspaces-and-branches) · [API](https://www.conductor.build/docs/api)
