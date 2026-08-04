# Architecture

> Decision status: Accepted for the current repository shape  
> Implementation evidence: Observed current repository; Runtime/Web code and deterministic checks exist, while installed cross-process Smoke remains `Not verified`

这是当前目录的物理 Codemap，不保存目标设计、工程规则或易变化的测试数量。

## 当前结构

```text
AGENTS.md                    仓库级 Agent 导航和工作规则
README.md                    人类入口与当前阶段
ARCHITECTURE.md              当前物理结构和依赖
.symphoneer/
  WORKFLOW.md                进入 Git 的 repository-owned 配置与 Prompt
package.json                 pnpm check / test 入口
pnpm-workspace.yaml          packages 与 apps 的 workspace
packages/
  contracts/
    src/                     版本化边界 Schema
      index.ts               package 公开 Interface
  adapters/
    src/                     真实边界 Adapter；不承载调度或持久化
      index.ts               package 公开 Interface
      github-issues.ts       GitHub Issue 读取、原生身份和 dispatch gate
      git-worktree/          Git worktree 创建、恢复、脏目录保护和安全释放
        index.ts             GitWorktreeDriver 公开 Interface
      worktree-fingerprint/  Git Worktree 与 Verification 共享的状态不变量
      codex-app-server/      Codex v2 JSONL transport 与 Agent Runner Adapter
      verification/          独立检查进程与 immutable artifact
        index.ts             VerificationRunner 公开 Interface
  symphony-core/
    src/
      scheduler/             Attempt、Turn、retry、reconciliation 与所有权状态机
        index.ts             Scheduler 公开 Interface
        dispatch/            排序、资格、并发与 Workspace reservation
        attempt/             Attempt 与活跃 Turn 生命周期
        retry/               Retry / continuation 生命周期
        eligibility.ts       多种 Scheduler 行为共享的可调度判定
      workflow/              WORKFLOW.md Schema、解析、路径和 Prompt
        index.ts             Workflow 公开 Interface
      workspace/             引用、身份登记、本地目录与 lifecycle hook
        index.ts             Workspace 公开 Interface
      agent-runner.ts        Agent Runner Interface
  runtime/
    src/
      storage.ts             append-only JSONL 与 immutable artifact store
      projection.ts           可重放的 Runtime 查询投影
      service.ts              Runtime 写入、幂等控制和命令边界
      http.ts                 loopback HTTP / SSE API
      client.ts               CLI / Web 共用的 Runtime client
      cli.ts                  `runtime:serve` 进程启动与查询 CLI
      index.ts                package 公开 Interface
  i18n/
    src/
      locales.ts              Locale 与纯检测函数
      messages/                按 locale 分文件的共享字典
      index.ts                 package 公开 Interface
apps/
  web/
    middleware.ts             locale 路由检测与重定向
    app/[locale]/             Next.js 页面与 locale layout
    app/api/runtime/          Runtime BFF Route Handlers
    components/task-board/    Task-first UI，按 Chrome、Task、Attempt 行为拆分
    components/               Web 适配的语言与主题控件
    lib/                      loopback Runtime 与 Intl 格式化边界
    app/globals.css           Tailwind CSS v4 语义主题 token 与可访问性基础样式
scripts/check-project.mjs    链接、Agent 导航、Plan、测试位置和依赖检查
tests/
  adapters/                  真实 Adapter 的确定性 contract / failure checks
  contracts/                 共享 Schema 与 Agent Runner contract
  core/
    scheduler/               eligibility、调度、retry、reconciliation 与所有权场景
    workspace/               Workspace 引用、生命周期与安全场景
    workflow.test.ts         Workflow 配置和 Prompt
  integration/               Fake Runner 到 Core Attempt 的确定性流程
  runtime/                   JSONL 重放、artifact、Runtime 命令、HTTP / SSE
  fixtures/                  测试专用 Fake；不是 Provider 证据
docs/
  AGENTS.md                  文档总路由和事实源归属
  design-docs/               产品和架构决定
  product-specs/             用户可观察行为与验收
  references/                外部契约和采用边界
  research/
    AGENTS.md                日期快照的按需入口
  plans/
    AGENTS.md                Plan 契约、状态和生命周期
    active/
      symphoneer-v1.md       当前 V1 执行计划
```

当前已有独立 `packages/runtime` 和普通 `apps/web`；没有数据库、队列、CI、部署配置或生成流水线。Runtime 持久化使用 Host 注入的数据目录，Web 通过 loopback HTTP / SSE 访问 Runtime，`/healthz` 直接报告 Runtime 进程的 PID、启动时间和运行时长；完整浏览器人工审查、真实安装目录发现、GitHub 网络和 Codex 真实 Turn 仍未验证。

## 当前代码依赖

```text
packages/contracts ──> Zod
packages/i18n ──> Node/Browser 标准库（无 React/Next 依赖）
packages/symphony-core ──> contracts + Node stdlib + YAML + LiquidJS + Zod
packages/adapters ──> contracts + symphony-core + Node stdlib
packages/runtime ──> contracts + Node stdlib
apps/web ──> contracts + i18n + runtime + Next.js + React + Tailwind CSS + next-themes
tests ──> contracts + symphony-core + adapters + runtime + tests/fixtures/FakeAgentRunner
```

- `contracts` 不依赖 Core、Web 或 Provider。
- `symphony-core` 不依赖 Next.js、GitHub SDK 或 Codex 进程实现。
- `adapters` 使用 Node 原生 `fetch`、Git CLI、Codex stdio JSONL 和子进程，不引入 Provider SDK。
- `packages/runtime` 是历史投影与受控 Runtime API 的边界；它不复制 `CoreScheduler` 的调度权威，`pause` / `retry` 当前只记录经过版本和幂等校验的控制请求。
- `apps/web` 是独立 Next.js 进程；浏览器请求经过 Route Handler 转发到 loopback Runtime，Task Board 只展示 Runtime 投影，Workspace 只在 Attempt detail 中展开。
- `CoreScheduler` 是 Attempt 序号、claim、活跃 Attempt、Workspace owner、活跃 Turn、retry 与 reconciliation 的单一内存写入权威；幂等重放窗口有界。
- `WorkspaceManager` 通过小型 driver seam 管理身份、所有权和 lifecycle hook；默认目录 driver 保留 #13 的准备行为，但只能非递归删除空目录且不支持重启恢复；Git driver 使用无 `--force` 的原生 worktree 操作。
- `.symphoneer/WORKFLOW.md` 已验证解析与 Host Workspace root 优先级；Core 读取 Workflow，Runtime 数据目录和 Web endpoint 由 Host / 环境注入，因此不证明操作系统应用目录发现、动态 reload 或真实执行。
- `CodexAppServerAdapter` 根据本机 `codex-cli 0.146.0` 生成的 v2 Schema 实现协议子集；确定性 transcript test 与 Fake 均不升级为真实兼容证据。
- Scheduler 当前按 `dispatch / attempt / retry` 行为聚类；公开导出仍由 `scheduler/index.ts` 提供。

## 设计与计划入口

产品、架构、规格、外部契约和 Research 路由见 [`docs/AGENTS.md`](docs/AGENTS.md)；当前实施顺序、证据和恢复状态见 [`docs/plans/active/symphoneer-v1.md`](docs/plans/active/symphoneer-v1.md)。目标设计不能从本 Codemap 的目录树反推。
