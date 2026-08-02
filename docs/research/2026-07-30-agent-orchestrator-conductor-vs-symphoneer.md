# Agent Orchestrator、Conductor 与 Symphoneer

核实日期：2026-07-30

> **Decision（2026-08-01）：** 本文的产品对比仍作为输入；将 Symphoneer 定位为
> Evidence/Harness Sidecar 的旧建议已经被取代。当前产品以 Symphony Runtime 为
> 核心，Evidence 与 Harness 是增强能力。以
> [`product-boundary.md`](../design-docs/product-boundary.md) 为准。

## 对象确认

- 开源 Agent Orchestrator：当前官方仓库已由旧的
  `ComposioHQ/agent-orchestrator` 重定向到
  [`Untrivial-ai/agent-orchestrator`](https://github.com/Untrivial-ai/agent-orchestrator)，
  当前 README 标注 Apache-2.0。
- 闭源 Conductor：[`conductor.build`](https://www.conductor.build/) 的 macOS
  Coding Agent 桌面产品，并提供 Beta Cloud API。
- 当前方案：本地
  [`Symphoneer`](../design-docs/product-boundary.md)
  规划文档；尚未实现，所有真实集成仍为 `Not verified`。

## 核心判断

当前 Symphoneer 的基础主干与两者高度重叠：

```text
任务/Issue
→ 隔离 worktree
→ Agent session
→ Diff / PR / CI
→ Review
→ Merge
```

因此，多 Agent、worktree、任务看板、实时终端、重试、PR/CI/Review 集成不能作为
Symphoneer 的主要差异。

Symphoneer 仍有独立空间，但必须收窄到：

> 将一次交付的 Task、Run、独立验证证据、人工决定和当时生效的 repo-local Harness
> 修订关联起来，并把重复失败转成可审核的 Harness Finding。

## 对比

| 维度 | Agent Orchestrator | Conductor | 当前 Symphoneer 方案 |
|---|---|---|---|
| 产品形态 | 开源、跨平台 Agent IDE + 本地 daemon | 闭源 macOS App + Cloud API | 计划中的本地研究/求职 Demo |
| 核心模型 | Project → Issue/Prompt → Session → Worktree → PR | Project → Workspace/Branch → Chat → Review | Task → Run → Verification → Human Review → Finding |
| Agent | 23 个终端 Agent Adapter；独立 Orchestrator/Worker 角色 | Claude Code、Codex、Cursor、OpenCode | V1 只计划 Codex App Server |
| Task Source | GitHub、GitLab、Linear、自由 Prompt | 手工 Workspace，可从 Issue/PR/Branch 开始 | V1 计划 GitHub Issues |
| 隔离 | Worktree/Clone Adapter | 每 Workspace 一个 Git worktree | 计划隔离 Workspace |
| 运行控制 | 生命周期、终端、阻塞、恢复、自动 Reaction | 交互式 Chat、Agent Mode、Goal、Checkpoint | 计划派发、继续、重试和人工接管 |
| PR 闭环 | 自动观察 CI/Review/冲突并把反馈送回 Agent | Diff Viewer、Checks、评论、PR、Merge、Archive | 计划统一展示验证与 Review |
| 自动化 | 可自动处理 CI/Review，配置可自动 Merge | 更偏人工工作台；也可用 Cloud API 编排 | 明确 Manual-first、Human authority |
| 观测 | Durable facts、派生状态、运行 Telemetry | 产品内 Workspace/Chat/Diff/Checks | 计划增加 Phoenix Trace 深链和证据状态 |
| Harness | 项目规则、插件、Agent Adapter、反馈报告 | Repository Settings、脚本、`AGENTS.md`、Skills | 计划保存 Harness Snapshot，失败生成 Finding |
| MCP | 不是主要产品接口 | 未作为主要产品边界 | 计划只读查询 Run/Snapshot/Finding |

## Agent Orchestrator 已覆盖的部分

官方资料显示 AO 已具备：

- 任务/Prompt 生成独立 Worktree 和 Agent Session；
- 一个只读 Orchestrator Agent 负责规划、派发和监督 Worker；
- Dashboard、实时终端、PR/CI/Review 状态；
- CI 失败、Review comments、Merge conflicts 自动回送原 Worker；
- GitHub/GitLab/Linear Tracker 和 GitHub/GitLab SCM Adapter；
- Reviewer Agent、浏览器 Preview、可配置 Reaction，甚至可选自动 Merge；
- 持久运行事实、派生展示状态和结构化运行 Telemetry。

来源：

- [AO README](https://github.com/Untrivial-ai/agent-orchestrator)
- [AO Introduction](https://aoagents.dev/docs)
- [AO Architecture](https://github.com/Untrivial-ai/agent-orchestrator/blob/main/docs/architecture.md)
- [AO Review loop](https://aoagents.dev/docs/guides/review-loop)
- [AO per-role agents](https://aoagents.dev/docs/guides/per-role-agents)

## Conductor 已覆盖的部分

官方资料显示 Conductor 已具备：

- 每个任务一个 Workspace、Branch、Worktree、Chat 和运行环境；
- Claude Code、Codex、Cursor、OpenCode 并行运行；
- Setup/Run scripts、环境文件复制、多个本地运行端口；
- Diff Viewer、行级评论、Agent Review、Checks、CI、Deployment、GitHub Review；
- 从 GitHub/Linear Issue、PR 或 Branch 创建 Workspace；
- 人工 Merge/Archive，以及 Beta Cloud API 的 Workspace、Session 和消息控制。

来源：

- [Conductor Docs](https://www.conductor.build/docs)
- [Workspaces and branches](https://www.conductor.build/docs/concepts/workspaces-and-branches)
- [Review and merge](https://www.conductor.build/docs/guides/review-and-merge)
- [Checks](https://www.conductor.build/docs/reference/checks)
- [Conductor API](https://www.conductor.build/docs/api)

## 当前 Symphoneer 不能再主打什么

- “一个页面管理多个 Agent”；
- “每个 Agent 一个 Worktree”；
- “从 Issue 派发 Coding Agent”；
- “查看终端、Diff、PR、CI、Review”；
- “CI 失败或 Review 后让 Agent 继续修改”；
- “支持多个 Agent/Tracker Adapter”。

这些已经分别被 AO 和 Conductor 做得更完整。

## 仍值得验证的差异

现有一手资料没有显示 AO 或 Conductor 将以下内容作为核心交付模型：

1. 记录某次 Run 实际生效的 `AGENTS.md`、Skills、Hooks、验证命令、CI 和架构约束
   修订；
2. 将需求中的完成声明逐项映射到独立、可重复的验证证据；
3. 没有证据时明确显示 `Not verified`，而不是仅把 Agent idle、PR opened 或 CI green
   当成完成；
4. 将重复失败聚合为带 Run 引用、Harness 修订和验证路径的 Finding；
5. 由人决定 Finding 是否升级为 Harness 改进任务，并比较修改前后的真实运行结果。

这不是“更强的调度”，而是“交付证据和 Harness 改进治理”。

## 产品边界建议

如果目标是学习完整 Agent 工程链路，可以保留一个最小
GitHub Issues + Codex App Server Conductor，但应把它视为内部基础设施。

如果目标是形成独立产品差异，应考虑把 Symphoneer 做成 AO、Conductor 或 Symphony
运行结果之上的 Evidence/Harness Sidecar，而不是重做完整 Agent IDE。

V1 只需证明一个故事：

```text
一条 Task
→ 一次 Codex Run
→ 一组可判定验证证据
→ 一次人工 Review
→ 一个可追溯 Harness Finding
```

跳过多 Agent、多 Tracker、通用 Adapter 框架和完整实时终端；只有第二个真实 Run
Provider 出现时再抽取 Adapter seam。
