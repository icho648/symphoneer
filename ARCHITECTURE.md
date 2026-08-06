# Architecture

> Decision status: Accepted for the current repository shape  
> Implementation evidence: Observed current repository; Runtime/Web code and deterministic checks exist, while installed cross-process Smoke remains `Not verified`

这是当前目录的物理 Codemap，不保存目标设计、工程规则或易变化的测试数量。

## 当前结构

```text
AGENTS.md                    仓库级 Agent 导航和工作规则
README.md                    人类入口与当前阶段
ARCHITECTURE.md              当前物理结构和依赖
.nvmrc                       本地与 CI 共用的 Node 版本下界
.github/
  workflows/check.yml        Pull Request / main 上的 `pnpm check` CI
.symphoneer/
  WORKFLOW.md                进入 Git 的 repository-owned 配置与 Prompt
package.json                 根依赖安装、共享工具和运行编排
src/
  contracts/                 Runtime / CLI / Web / MCP 共用的版本化边界 Schema
    package.json              私有 link package identity（@symphoneer/contracts）
    index.ts                 共享契约入口
  runtime-client/            CLI / Web / MCP 共用的 Runtime HTTP client
    package.json              私有 link package identity（@symphoneer/runtime-client）
    index.ts                  Runtime HTTP client
  runtime/                   唯一核心长期运行进程的内部 Module
    package.json              Runtime 进程脚本边界
    executor/                执行者边界和生产执行者实现
      agent-runner.ts        Agent Runner Interface
      index.ts               Executor 公开入口
      codex-app-server/      Codex v2 JSONL transport 与执行者实现
    tracker/                 Tracker 边界和具体 Tracker 实现
      tracker.ts             Tracker Interface
      github-issues.ts       GitHub Issue 读取、原生身份和 dispatch gate
      index.ts               Tracker 公开入口
    workspace/                Workspace 引用、生命周期和 Git 实现
      git-worktree/           Git worktree 创建、恢复、脏目录保护和安全释放
      fingerprint/            Git Worktree 与 Verification 共享的状态不变量
    verification/             独立检查进程与 immutable artifact
    scheduler/                Attempt、Turn、retry、reconciliation 与所有权状态机
      dispatch/               排序、资格、并发与 Workspace reservation
      attempt/                Attempt 与活跃 Turn 生命周期
      retry/                  Retry / continuation 生命周期
      eligibility.ts           多种 Scheduler 行为共享的可调度判定
    workflow/                 WORKFLOW.md Schema、解析、路径和 Prompt
    storage.ts                append-only JSONL 与 immutable artifact store
    projection.ts             可重放的 Runtime 查询投影
    service/                  Runtime 写入、幂等窗口、EventLog 与命令边界
      index.ts                RuntimeService 公开入口
      event-log.ts            append-only 重放、幂等与投影驱动
      helpers.ts              Attempt / Workspace / command 纯辅助
      recording.ts            Domain Event 记录 API
      commands.ts             受控命令形状校验与并发前置条件
      runtime-service.ts      RuntimeService 编排入口
    http.ts                   loopback HTTP / SSE API
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
    middleware.ts             locale 路由检测与重定向
    app/[locale]/             Next.js 页面与 locale layout
    app/api/runtime/          Runtime BFF Route Handlers
    components/task-board/    Task-first UI，按 Chrome、Task、Attempt 行为拆分
    components/               Web 语言与主题控件
    i18n/                     Web 内部 locale、字典和纯函数
    lib/                      loopback Runtime 与 Intl 格式化边界
    app/globals.css           Tailwind CSS v4 语义主题 token 与可访问性基础样式
scripts/
  check-project.mjs          链接、Agent 导航、Plan、测试位置、依赖与 Codemap 路径检查
  dev.ts                     Runtime 与 Web 的产品级前台 launcher（`pnpm up` / `pnpm dev`，纳入 tsc）
tests/
  unit/                       纯模块行为
    scheduler/                Scheduler 可观察行为（dispatch、eligibility、retry…）
    web/                      Web 纯函数、i18n 与 task projection
  contract/                   共享 Schema、Agent Runner / Tracker / Verification contract
  integration/                本地多模块协作（Runtime、MCP、Workspace、Workflow、适配器）
    executor/                 Codex 执行者 contract / failure checks
    mcp/                      MCP 工具契约、Runtime 映射、Apps resource 与错误语义
    runtime/                  JSONL 重放、artifact、Runtime 命令、HTTP / SSE
    verification/             Verification runner 与 artifact 行为
    web/                      Web launcher 健康检查
    workflow/                 WORKFLOW.md 解析与 Prompt
    workspace/                Workspace 生命周期、引用、安全与 Git worktree
  e2e/                        Issue、Workspace、Codex、Verification 跨边界闭环
  fixtures/                   测试专用 Fake；不是 Provider 证据
acceptance/
  AGENTS.md                   人类执行和验收流程规则
  host/                       真实 Host / 外部客户端兼容性流程
docs/
  AGENTS.md                  文档总路由和事实源归属
  design-docs/               产品和架构决定
  product-specs/             用户可观察行为与验收
  references/                外部契约和采用边界
  research/                  日期快照的按需入口
  plans/active/              当前 V1 执行计划
```

当前没有 workspace 安装布局、`packages/` 或 `apps/` 目录；Runtime、CLI、Web、MCP 各有进程边界 manifest，`src/contracts`、`src/runtime`、`src/runtime-client` 和 `src/mcp` 通过根 `package.json` 的 `link:` 依赖暴露为 `@symphoneer/contracts`、`@symphoneer/runtime`、`@symphoneer/runtime-client` 和 `@symphoneer/mcp`，依赖仍由根统一安装，因此只有根 `node_modules`；`pnpm-workspace.yaml` 只记录依赖构建脚本的授权决定。CI 通过 `.github/workflows/check.yml` 在 Pull Request 与 `main` 上运行 `pnpm install --frozen-lockfile` 与 `pnpm check`（超时按完整 `pnpm check` ≈82s 量级设为 15 分钟）；没有数据库、队列、部署配置或生成流水线。`.symphoneer/WORKFLOW.md` 的 Verification `timeout_ms` 为 300000（5 分钟），相对实测完整检查约 82s 保留约 3.5× 余量，避免慢机器或冷缓存把超时误报为检查失败。`src/web/tsconfig.json` 与根配置共享 `exactOptionalPropertyTypes`、`noUncheckedIndexedAccess`、`verbatimModuleSyntax`、`erasableSyntaxOnly`；仅保留 `skipLibCheck: true`，因为 Next.js / React 类型包在关闭该选项时会产生与产品代码无关的第三方诊断。Runtime 持久化使用 Host 注入的数据目录，Web 与 MCP 通过 loopback HTTP 访问 Runtime，`/healthz` 直接报告 Runtime 进程的 PID、启动时间和运行时长；完整浏览器人工审查、真实 Codex MCP Host、MCP Apps Host、真实安装目录发现、GitHub 网络和 Codex 真实 Turn 仍未验证。`scripts/dev.ts` 是产品级 launcher（与 `docs/design-docs/system-boundaries.md` 一致），纳入根 `tsc` 覆盖，不是未被类型检查的开发脚本旁路。

## 当前代码依赖

```text
src/contracts ──> Zod
src/runtime ───> src/contracts + Node stdlib + Zod + YAML + LiquidJS
src/runtime-client ──> src/contracts + Node stdlib
src/mcp ────────────> src/contracts + src/runtime-client + MCP SDK
src/cli ────────────> src/runtime-client + Node stdlib
src/web ────────────> src/contracts + src/runtime-client + Web i18n + Next.js / React
tests ────────> src/runtime + src/cli + src/web + src/mcp 的可测试 Module + tests/fixtures/FakeAgentRunner
```

- `@symphoneer/contracts` 是 `src/contracts` 的本地 link；它不依赖 Web、CLI、Runtime、MCP 或具体执行者，是跨进程边界的共享 Schema。
- `src/runtime` 不依赖 Next.js、React、GitHub SDK 或 Codex 进程实现之外的 Web 模块，也不依赖自己的 HTTP client；`src/web`、`src/mcp` 与 `src/cli` 只经 `@symphoneer/runtime-client` 访问 Runtime。Web / MCP 方向由 `scripts/check-project.mjs` 检查。
- `src/runtime/executor` 使用 Codex stdio JSONL；`src/runtime/tracker` 使用 Node 原生 `fetch`；Workspace 和 Verification 使用 Git CLI 与子进程。
- `src/runtime` 是历史投影、调度、执行边界和受控 Runtime API 的单一运行进程；其 HTTP 入口为 `serve.ts`。CLI、Web 和 MCP 不复制 Scheduler 或业务状态机。
- `src/cli` 是人用 CLI / TUI 访问面（当前仅 Runtime 查询命令），不是 Runtime / MCP 的进程入口。
- `src/mcp` 是 Host 拉起的独立 STDIO 适配进程；只暴露查询与三种受控 Runtime 命令，不提供 Commit / Merge / dispatch，也不远程公开 loopback Runtime。
- `src/web` 是独立 Next.js 进程；浏览器请求经过 Route Handler 转发到 loopback Runtime，Task Board 只展示 Runtime 投影，Workspace 只在 Attempt detail 中展开。
- `CoreScheduler` 是 Attempt 序号、claim、活跃 Attempt、Workspace owner、活跃 Turn、retry 与 reconciliation 的单一内存写入权威；幂等重放窗口有界。
- `WorkspaceManager` 通过小型 driver seam 管理身份、所有权和 lifecycle hook；默认目录 driver 保留 #13 的准备行为，但只能非递归删除空目录且不支持重启恢复；Git driver 使用无 `--force` 的原生 worktree 操作。
- `.symphoneer/WORKFLOW.md` 已验证解析与 Host Workspace root 优先级；Runtime 数据目录和 Web endpoint 由 Host / 环境注入，因此不证明操作系统应用目录发现、动态 reload 或真实执行。
- `CodexAppServerAdapter` 根据本机 `codex-cli 0.146.0` 生成的 v2 Schema 实现协议子集；确定性 transcript test 与 Fake 均不升级为真实兼容证据。
- Scheduler 当前按 `dispatch / attempt / retry` 行为聚类；Runtime 公开导出由对应 Module 的 `index.ts` 提供。

## 设计与计划入口

产品、架构、规格、外部契约和 Research 路由见 [`docs/AGENTS.md`](docs/AGENTS.md)；当前实施顺序、证据和恢复状态见 [`docs/plans/active/symphoneer-v1.md`](docs/plans/active/symphoneer-v1.md)。目标设计不能从本 Codemap 的目录树反推。
