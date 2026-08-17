# Architecture

> Decision status: Accepted for the current repository shape  
> Implementation evidence: Observed current repository; deterministic checks cover the production Tracker tick, Scheduler, per-Issue Workspace, Attempt Worker and UI path, while real fixture GitHub/Codex execution and MCP Host / Apps Host integration remain `Not verified`

这是当前目录的物理 Codemap，不保存目标设计、工程规则或易变化的测试数量。

## 当前结构

```text
AGENTS.md                    仓库级 Agent 导航和工作规则
README.md                    人类入口与当前阶段
ARCHITECTURE.md              当前物理结构和依赖
.nvmrc                       本地与 CI 共用的 Node 版本下界
.github/
  workflows/check.yml        Pull Request / main 上的 `pnpm check` CI
  workflows/pages.yml        将 site/ 发布到 GitHub Pages
WORKFLOW.md                  进入 Git 的 ProjectProfile（repository-owned 配置与 Prompt）
.symphoneer/
  orchestrations/            OrchestrationDefinition JSON IR（当前 PIR）
package.json                 根依赖安装、共享工具和运行编排
src/
  contracts/                 Runtime / CLI / Web / MCP 共用的版本化边界 Schema
    package.json              私有 link package identity（@symphoneer/contracts）
    index.ts                 共享契约入口
    orchestration.ts         OrchestrationDefinition / binding / hash
  runtime-client/            CLI / Web / MCP 共用的 RuntimeClient + Transport
    package.json              私有 link package identity（@symphoneer/runtime-client）
    index.ts                  RuntimeClient 公开入口
    client.ts                 DefaultRuntimeClient 领域方法
    transport.ts              RuntimeTransport seam
    http-transport.ts         HttpRuntimeTransport（HTTP / SSE）
    errors.ts                 typed client errors
  runtime-tools/             MCP / Assistant 轻量 Tool Definition 与 Disabled Assistant
    package.json              私有 link package identity（@symphoneer/runtime-tools）
    index.ts                  公开入口
    definitions.ts            Runtime tool definitions
    assistant.ts              AssistantAdapter seam
    types.ts                  Tool Definition 类型
  runtime/                   Runtime 进程与单项目 Symphony Core 的内部 Module
    package.json              Runtime 进程脚本边界
    executor/                执行者边界和生产执行者实现
      agent-runner.ts        Agent Runner Interface
      index.ts               Executor 公开入口
      codex-app-server/      Codex v2 JSONL transport 与执行者实现
    tracker/                 Tracker 边界和具体 Tracker 实现
      tracker.ts             Tracker Interface
      github-issues.ts       GitHub Issue 读取、原生身份和 dispatch gate
      synchronizer.ts        项目级全量同步、缺失任务对账和并发刷新合并
      index.ts               Tracker 公开入口
    workspace/                Workspace 引用、生命周期和 Git 实现
      git-worktree/           Git worktree 创建、恢复、脏目录保护和安全释放
      fingerprint/            Git Worktree 与 Verification 共享的状态不变量
    verification/             独立检查进程与 immutable artifact
    team/                      LangGraph orchestration 编排、人工门控与执行器适配
      workflow.ts              plan-implement-review StateGraph 实现
      orchestrator.ts          可持久化 checkpoint 的 Orchestration seam
      agent-runner-adapter.ts  现有 AgentRunner 到 workflow executor 的适配
      fake-agent-runner.ts     垂直切片用 deterministic Fake executor
      fake-verification.ts     测试用 Verification adapter
      runtime.ts               Runtime commands、事件与投影协调
    scheduler/                Attempt、Turn、retry、reconciliation 与所有权状态机
      dispatch/               排序、资格、并发与 Workspace reservation
      attempt/                Attempt 与活跃 Turn 生命周期
      retry/                  Retry / continuation 生命周期
      eligibility.ts           多种 Scheduler 行为共享的可调度判定
    workflow/                 ProjectProfile（WORKFLOW.md）Schema、解析、路径和 Prompt
    orchestration/            OrchestrationDefinition 与默认编排 mode facade
      mode.ts                 OrchestrationMode public seam
      single-agent.ts         GitHub → Workspace → Codex → Human review 实现
    host/                     应用级项目目录、Runtime 聚合与 Host 安全边界
      application-data.ts     项目注册表、稳定身份和持久化路径约定
      desktop-runtime-host.ts 多项目聚合；每个项目持有独立单项目 RuntimeService
      polling-coordinator.ts  单一轮询时钟、退避、全局串行和项目回调注册
      config.ts               应用级 Host 配置解析
      open-finder.ts          通过 Host 在 macOS Finder 打开受控工作路径
      repositories.ts         当前项目 GitHub remote 发现与仓库候选
      security.ts             Host / Origin / token / redaction
      static-ui.ts            Vite dist 静态托管与 SPA fallback
      index.ts                Host 公开入口
    storage.ts                append-only JSONL 与 immutable artifact store
    projection.ts             可重放的 Runtime 查询投影
    service/                  单项目 Runtime 写入、幂等窗口、EventLog 与命令边界
      control-plane.ts        HTTP 面向的最小 Runtime 查询与命令接口
      index.ts                RuntimeService 公开入口
      event-log.ts            append-only 重放、幂等与投影驱动
      helpers.ts              Attempt / Workspace / command 纯辅助
      recording.ts            Domain Event 记录 API
      commands.ts             受控命令形状校验与并发前置条件
      operator-log.ts         project-scoped、脱敏的 operator JSONL
      runtime-service.ts      RuntimeService 编排入口
    http.ts                   loopback HTTP / SSE API 与静态 UI 入口
    protocol.ts               Runtime API 形状（`@symphoneer/runtime/protocol`）
    serve.ts                  Runtime HTTP 进程入口（`pnpm runtime:serve`）
    index.ts                  Runtime 内部公开入口
  mcp/                       Host 拉起的 STDIO MCP 适配层（薄封装 RuntimeClient）
    package.json              私有 link package identity（@symphoneer/mcp）
    index.ts                  组装 Server、loopback URL、公开导出
    stdio.ts                  MCP STDIO 进程入口（`pnpm mcp:serve`）
    tools.ts                  查询 / 受控变更工具与能力审计常量
    results.ts                Runtime 错误到 MCP 可区分结果
    resources.ts              可选 MCP Apps ui:// resources
  cli/
    AGENTS.md                 人用 CLI / TUI 局部规则（非 Runtime/MCP 进程入口）
    package.json              人用 CLI / TUI 进程边界（当前仅查询命令）
    runtime.ts                人用 Runtime 查询 CLI（snapshot / events / attempt）
  web/
    package.json              Web 进程脚本边界
    vite.config.ts            Vite SPA 构建与开发代理
    index.html                SPA 入口
    main.tsx                  React bootstrap
    app.tsx                   locale Router
    runtime-provider.tsx      RuntimeClient provider
    components/task-board/    Task-first UI，按 Chrome、Task、Attempt 行为拆分
    components/ui/            shadcn/ui 生成的 Dialog、Button、Input、Textarea、Label
    components.json            shadcn/ui 生成配置
    components/               Web 语言与主题控件
    i18n/                     Web 内部 locale、字典和纯函数
    lib/                      loopback URL、Intl 格式化和 cn() 工具边界
    app/globals.css           Tailwind CSS v4 语义主题 token 与可访问性基础样式
    public/                   静态品牌资源
site/                        GitHub Pages 静态展示页（不进入 Runtime 依赖）
  index.html
  styles.css
  script.js
  brand/
    symphoneer-icon.png
  screenshots/
    task-board.png
    task-detail.png
scripts/
  check-project.mjs          链接、Agent 导航、Plan、测试位置、依赖与 Codemap 路径检查
  dev.ts                     Runtime 与 Vite Web 的产品级前台 launcher（`pnpm up` / `pnpm dev`，纳入 tsc）
tests/
  contracts/                 共享 Schema 与 Agent Runner / Tracker contract
  scheduler/                 Scheduler 可观察行为（dispatch、eligibility、retry…）
  workspace/                 Workspace 生命周期、引用、安全与 Git worktree
  workflow/                  ProjectProfile（WORKFLOW.md）解析与 Prompt
  orchestration/             OrchestrationDefinition JSON IR parser / hash
  executor/                  Codex 执行者 contract / failure checks
  tracker/                   GitHub Tracker contract / failure checks
  verification/              Verification contract / failure checks
  runtime/                   JSONL 重放、artifact、Runtime 命令、HTTP / SSE / Host UI
  runtime-client/            RuntimeTransport / headless client smoke
  assistant/                 Disabled Assistant seam
  team/                      LangGraph TeamRun / Fake Agent vertical slice
  mcp/                       MCP 工具契约、Runtime 映射、Apps resource 与错误语义
  web/                       Web 纯函数、i18n 与 launcher 健康检查
  integration/               Fake Runner 到 Core Attempt 的确定性跨边界流程
  fixtures/                  测试专用 Fake；不是 Provider 证据
docs/
  AGENTS.md                  文档总路由和事实源归属
  design-docs/               产品和架构决定
  product-specs/             用户可观察行为与验收
  references/                外部契约和采用边界
  research/                  日期快照的按需入口
  plans/active/              当前 Issue 本地恢复计划
  plans/completed/           已完成的历史协调计划
```

当前没有 workspace 安装布局、`packages/` 或 `apps/` 目录；Runtime、CLI、Web、MCP 和 runtime-tools 各有进程边界 manifest，`src/contracts`、`src/runtime`、`src/runtime-client`、`src/runtime-tools` 和 `src/mcp` 通过根 `package.json` 的 `link:` 依赖暴露为对应的 `@symphoneer/*` package，依赖仍由根统一安装，因此只有根 `node_modules`；`pnpm-workspace.yaml` 只记录依赖构建脚本的授权决定。CI 通过 `.github/workflows/check.yml` 在 Pull Request 与 `main` 上运行 `pnpm install --frozen-lockfile` 与 `pnpm check`；`.github/workflows/pages.yml` 把 `site/` 静态展示页发布到 GitHub Pages，不进入 Runtime 依赖。本地 Orchestration checkpoint 使用 Runtime 数据目录中的 SQLite，Domain Event 与 artifact 仍使用 JSONL/immutable store，没有外部数据库或队列。根 `WORKFLOW.md` 的 Verification `timeout_ms` 为 300000（5 分钟）；根文件缺失时 loader 兼容旧 `.symphoneer/WORKFLOW.md` 并记录弃用操作。`src/web/tsconfig.json` 与根配置共享 `exactOptionalPropertyTypes`、`noUncheckedIndexedAccess`、`verbatimModuleSyntax`、`erasableSyntaxOnly`；仅保留 `skipLibCheck: true`，因为 React 类型包在关闭该选项时会产生与产品代码无关的第三方诊断。Runtime 持久化使用 Host 注入的数据目录；开发模式下 Vite 代理到 Runtime，Standalone 模式由 Runtime 同源托管 Vite 静态 UI、API 与 SSE。`/healthz` 直接报告 Runtime 进程的 PID、启动时间和运行时长；确定性 Fake Tracker 测试覆盖生产 tick 自动 dispatch 和同 Worker 多 Turn；真实 GitHub fixture/Codex Turn、MCP Host、MCP Apps Host 和真实安装目录发现仍为 `Not verified`。`scripts/dev.ts` 是产品级 launcher（与 `docs/design-docs/system-boundaries.md` 一致），纳入根 `tsc` 覆盖，不是未被类型检查的开发脚本旁路。

## 当前代码依赖

```text
src/contracts ──> Zod
src/runtime ───> src/contracts + Node stdlib + Zod + YAML + LiquidJS + LangGraph + SQLite checkpoint
src/runtime-client ──> src/contracts + Node stdlib
src/runtime-tools ──> src/contracts + src/runtime-client + Zod
src/mcp ────────────> src/contracts + src/runtime-client + src/runtime-tools + MCP SDK
src/cli ────────────> src/runtime-client + Node stdlib
src/web ────────────> src/contracts + src/runtime-client + Web i18n + Vite / React Router
tests ────────> src/runtime + src/cli + src/web + src/mcp 的可测试 Module + tests/fixtures/FakeAgentRunner
```

- `@symphoneer/contracts` 是 `src/contracts` 的本地 link；它不依赖 Web、CLI、Runtime、MCP 或具体执行者，是跨进程边界的共享 Schema。
- `src/runtime` 不依赖 Vite、React、GitHub SDK 或 Codex 进程实现之外的 Web 模块，也不依赖自己的 HTTP client；`src/web`、`src/mcp` 与 `src/cli` 只经 `@symphoneer/runtime-client` 访问 Runtime。Web / MCP 方向由 `scripts/check-project.mjs` 检查。
- `src/runtime/executor` 使用 Codex stdio JSONL；`src/runtime/tracker` 使用 Node 原生 `fetch`；Workspace 和 Verification 使用 Git CLI 与子进程。
- `src/runtime/serve.ts` 是一个长期运行进程；应用级 `DesktopRuntimeHost` 聚合多个项目并持有统一 PollingCoordinator，而每个项目的 `RuntimeService` 仍独立持有 Tracker 同步、Symphony 调度状态、EventLog 和 checkpoint。CLI、Web 和 MCP 不复制 Scheduler 或业务状态机。
- `src/cli` 是人用 CLI / TUI 访问面（当前仅 Runtime 查询命令），不是 Runtime / MCP 的进程入口。
- `src/mcp` 是 Host 拉起的独立 STDIO 适配进程；只暴露查询与三种受控 Runtime 命令，不提供 Commit / Merge / dispatch，也不远程公开 loopback Runtime。
- `src/web` 是 Vite React SPA；浏览器只通过 RuntimeClient 访问 Runtime，Task Board 只展示 Runtime 投影，Workspace 只在 Attempt detail 中展开。
- `CoreScheduler` 是 Attempt 序号、claim、活跃 Attempt、Workspace owner、活跃 Turn、retry 与 reconciliation 的单一写入权威；Runtime 从持久化 Attempt / Workspace 投影重放状态，幂等窗口仍有界。
- `WorkspaceManager` 通过小型 driver seam 管理身份、所有权和 lifecycle hook；默认目录 driver 保留 #13 的准备行为，但只能非递归删除空目录且不支持重启恢复；Git driver 使用无 `--force` 的原生 worktree 操作。
- 根 `WORKFLOW.md` 按 ProjectProfile 解析；旧 `.symphoneer/WORKFLOW.md` 只作缺失回退；`.symphoneer/orchestrations/*.json` 是 OrchestrationDefinition JSON IR。每次 tick 尝试 reload，活跃 Worker 保留启动快照；Host poll cadence 的动态重注册尚未实现。
- `CodexAppServerAdapter` 根据本机 `codex-cli 0.146.0` 生成的 v2 Schema 实现协议子集；确定性 transcript test 与 Fake 均不升级为真实兼容证据。
- Scheduler 当前按 `dispatch / attempt / retry` 行为聚类；Runtime 公开导出由对应 Module 的 `index.ts` 提供。

## 设计与计划入口

产品、架构、规格、外部契约和 Research 路由见 [`docs/AGENTS.md`](docs/AGENTS.md)；当前范围与验收读关联 Issue / PR，本地恢复入口见 [`docs/plans/active/issue-47.md`](docs/plans/active/issue-47.md)。目标设计不能从本 Codemap 的目录树反推。
