# Architecture

> Decision status: Accepted for the current repository shape  
> Implementation evidence: Observed current repository; capability evidence remains owned by the associated Issue and PR

这是当前目录的物理 Codemap。它只说明代码放在哪里、Module 如何依赖；产品边界和状态权威见 `docs/core-concepts/`，实施状态见关联 Issue / PR。

## 当前结构

```text
AGENTS.md                    仓库级 Agent 导航与工程规则
README.md                    人类入口
ARCHITECTURE.md              当前物理结构与依赖
.nvmrc                       Node 版本下界
.github/
  workflows/                 CI workflow
.symphoneer/
  WORKFLOW.md                repository-owned ProjectProfile 与 Prompt
  orchestrations/            OrchestrationDefinition JSON IR
package.json                 根依赖、脚本与 link package 装配
scripts/
  check-project.mjs          链接、导航、依赖与 Codemap 检查
  dev.ts                     Runtime 与 Vite 的前台 launcher
src/
  sse.ts                     浏览器安全 SSE 字节分帧
  assistant/                 Pi Assistant 生命周期与 HTTP/SSE
  assistant-client/          Assistant 浏览器客户端与 Schema
  cli/                       人用 Runtime 查询 CLI
  contracts/                 跨进程共享契约
  mcp/                       STDIO MCP Adapter
  runtime/                   Runtime 与单项目 Symphony Core
    executor/                AgentRunner seam 与 Codex/Claude/Fake Adapter
    host/                    多项目 Host、注册表与应用目录
    orchestration/           Single Agent 与编排入口
    scheduler/               Attempt、Turn、retry 与 reconciliation
    service/                 EventLog、RuntimeService 与命令边界
    team/                    LangGraph TeamRun
    tracker/                 Tracker seam 与 GitHub Issues Adapter
    verification/            独立检查与 immutable artifact
    workflow/                ProjectProfile 解析与 Prompt
    workspace/               Workspace 生命周期与 Git worktree
  runtime-client/            CLI / Web / MCP 共用 RuntimeClient
  runtime-tools/             MCP / Assistant 共用 Tool Definition
  web/                       Vite React SPA
tests/
  assistant/                 Assistant Session、恢复与审批
  contracts/                 共享 Schema 与 seam contracts
  executor/                  Codex / Claude Executor 行为
  fixtures/                  测试专用项目与 Fake
  integration/               跨 Module 确定性流程
  mcp/                       MCP 映射与错误语义
  orchestration/             OrchestrationDefinition 与编排
  runtime/                   Runtime、HTTP/SSE、Host 与持久化
  runtime-client/            Runtime transport/client
  scheduler/                 dispatch、Attempt、retry 与 reconciliation
  team/                      TeamRun vertical slice
  tracker/                   GitHub Tracker contracts
  verification/              Verification contracts
  web/                       Web 纯函数、i18n 与 launcher
  workflow/                  ProjectProfile 与 Prompt
  workspace/                 Workspace 引用、Git worktree 与安全释放
docs/
  AGENTS.md                  文档路由与事实源规则
  core-concepts/             当前产品心智模型与对象权威
  decisions/                 已接受的跨 Issue 设计判断
  plans/                     必要的本地恢复与跨 Issue 协调
  references/                外部契约和采用边界
  research/                  带日期的调研输入
```

## 当前代码依赖

```text
contracts ────────────────────────────────────────────────> Zod
runtime ───────────> contracts + Node stdlib + Zod + YAML + LiquidJS + LangGraph
runtime-client ────> contracts + SSE + fetch
assistant-client ──> SSE + Zod + fetch
runtime-tools ─────> contracts + runtime-client + Zod
assistant ─────────> assistant-client + runtime-client + runtime-tools + Pi
mcp ───────────────> contracts + runtime-client + runtime-tools + MCP SDK
cli ───────────────> runtime-client + Node stdlib
web ───────────────> contracts + runtime-client + assistant-client + React/Vite
```

- `@symphoneer/contracts` 不依赖 Runtime、Web、CLI、MCP 或具体 Executor。
- Runtime 不依赖自己的 HTTP client，也不依赖 Web/Vite；Web、CLI 与 MCP 只通过 `@symphoneer/runtime-client` 访问 Runtime。
- `CoreScheduler` 负责 Attempt 序号、claim、Workspace owner、活跃 Turn、retry 与 reconciliation。
- `AgentRunner` 是 Executor seam；当前真实 Adapter 为 Codex App Server 与 Claude Code CLI，Fake 只用于确定性测试。
- `.symphoneer/WORKFLOW.md` 是进入 Git 的 ProjectProfile；应用数据、日志、缓存、Workspace 和凭据位置由安装 Host 决定。
- `DesktopRuntimeHost` 可以持有多个 ProjectRuntime，并共享一份进程级执行容量；每个项目仍保留独立 Tracker scope、Scheduler 与持久化目录。

## 设计与计划入口

产品、架构、规格、外部契约和 Research 路由见 [`docs/AGENTS.md`](docs/AGENTS.md)。当前范围与验收读取关联 Issue / PR；只有 Issue 无法承载本地恢复信息时才使用 `docs/plans/active/`。
