# Architecture

> Decision status: Accepted for the current repository shape  
> Implementation evidence: Observed current repository; application Runtime does not exist

这是当前目录的物理 Codemap，不保存目标设计、工程规则或易变化的测试数量。

## 当前结构

```text
AGENTS.md                    仓库级 Agent 导航和工作规则
README.md                    人类入口与当前阶段
ARCHITECTURE.md              当前物理结构和依赖
.symphoneer/
  WORKFLOW.md                进入 Git 的 repository-owned 配置与 Prompt
package.json                 pnpm check / test 入口
pnpm-workspace.yaml          当前两个 package 的 workspace
packages/
  contracts/
    src/                     版本化边界 Schema
      index.ts               package 公开 Interface
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
scripts/check-project.mjs    链接、Agent 导航、Plan、测试位置和依赖检查
tests/
  contracts/                 共享 Schema 与 Agent Runner contract
  core/
    scheduler/               eligibility、调度、retry、reconciliation 与所有权场景
    workspace/               Workspace 引用、生命周期与安全场景
    workflow.test.ts         Workflow 配置和 Prompt
  integration/               Fake Runner 到 Core Attempt 的确定性流程
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

当前没有 `apps/runtime`、`apps/web`、真实 Tracker / Agent Adapter、数据库、队列、CI、部署配置或生成流水线。现有代码只覆盖 Issue #13 的本地 Core seam。

## 当前代码依赖

```text
packages/contracts ──> Zod
packages/symphony-core ──> contracts + Node stdlib + YAML + LiquidJS + Zod
tests ──> contracts + symphony-core + tests/fixtures/FakeAgentRunner
```

- `contracts` 不依赖 Core、Web 或 Provider。
- `symphony-core` 不依赖 Next.js、GitHub SDK 或 Codex 进程实现。
- `CoreScheduler` 是 Attempt 序号、claim、活跃 Attempt、Workspace owner、活跃 Turn、retry 与 reconciliation 的单一内存写入权威；幂等重放窗口有界。
- `WorkspaceManager` 用 Node.js 标准库实现本地目录创建、复用、规范路径、身份登记、lifecycle hook、超时和安全回收；它不是 Git worktree manager。
- `.symphoneer/WORKFLOW.md` 已验证解析与 Host Workspace root 优先级；没有 Runtime 消费者，因此不证明操作系统应用目录发现、动态 reload 或真实执行。
- `FakeAgentRunner` 只位于测试分区，不能升级为 Codex 兼容证据。
- Scheduler 当前按 `dispatch / attempt / retry` 行为聚类；公开导出仍由 `scheduler/index.ts` 提供。

## 设计与计划入口

产品、架构、规格、外部契约和 Research 路由见 [`docs/AGENTS.md`](docs/AGENTS.md)；当前实施顺序、证据和恢复状态见 [`docs/plans/active/symphoneer-v1.md`](docs/plans/active/symphoneer-v1.md)。目标设计不能从本 Codemap 的目录树反推。
