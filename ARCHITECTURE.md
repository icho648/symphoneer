# Architecture

> Decision status: Accepted for the current repository shape  
> Implementation evidence: Observed Issue #13 contracts/core and 24 deterministic tests; application Runtime does not exist

这是当前目录的物理地图，不把后续 Runtime、Adapter 或产品界面写成已经实现。

## 当前结构

```text
AGENTS.md                    Agent 导航、范围和工作规则
README.md                    人类入口与当前阶段
ARCHITECTURE.md              当前物理结构和稳定文档边界
WORKFLOW.md                  repository-owned Workflow 配置与 Prompt
package.json                 pnpm check / test 入口
pnpm-workspace.yaml          当前两个 package 的 workspace
packages/
  contracts/
    src/                     按执行、验证、人类决定和事件分组的版本化 Zod Schema
      index.ts               package 单一公开 Interface
  symphony-core/
    src/
      scheduler/             Attempt、Turn、retry、reconciliation 与所有权状态机
        index.ts             Scheduler 单一公开 Interface
      workflow/              WORKFLOW.md Schema、解析、路径和 Prompt
        index.ts             Workflow 单一公开 Interface
      workspace/             引用、身份登记、本地目录与 lifecycle hook
        index.ts             Workspace 单一公开 Interface
      agent-runner.ts        Agent Runner Interface
      eligibility.ts         Task eligibility 判定
scripts/check-project.mjs    链接、索引、ExecPlan、测试位置和依赖方向检查
tests/
  contracts/                 共享 Schema 与 Agent Runner contract
  core/
    scheduler/               调度、retry、reconciliation 与所有权场景
    workspace/               Workspace 引用、生命周期与安全场景
    workflow.test.ts         Workflow 配置和 Prompt
    eligibility.test.ts      Task eligibility
  integration/               Fake Runner 到 Core Attempt 的确定性流程
  fixtures/                  测试专用 Fake；不是 Provider 证据
docs/
  PLANS.md                   ExecPlan 编写与维护契约
  design-docs/               产品和架构决定
  product-specs/             用户可观察行为与验收
  references/                外部契约和采用边界
  research/                  带日期的调研输入
  exec-plans/                复杂任务的活计划和完成记录
    active/
      symphoneer-v1.md  已确认的 V1 开发与验收计划
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
- `WorkspaceManager` 用 Node.js 标准库实现本地目录创建/复用、规范路径与身份登记、四个 lifecycle hook、超时和安全回收；它不是 Git worktree manager。
- `WORKFLOW.md` 是已验证可解析的配置文件；没有 Runtime 消费者时，它不能证明动态 reload 或真实执行。
- `FakeAgentRunner` 只位于测试分区，不能升级为 Codex 兼容证据。
- `scheduler`、`workflow`、`workspace` 各自把内部文件收在同名目录，只通过目录内 `index.ts` 暴露公开 Interface；120 行是 review threshold，不是机械拆分门禁。

## 稳定边界

- `AGENTS.md` 负责导航，不复制叶子文档内容。
- `design-docs/` 是确认后设计决定的事实源；`research/` 和 `references/` 只提供输入与外部事实。
- `product-specs/` 用可观察行为定义验收，不代替实现证据。
- `exec-plans/` 保存执行过程，不升级为产品规范。
- 代码测试集中在根 `tests/`；package 内不放 colocated 测试。
- 不存在来源和生成命令的材料不进入 `generated/`；当前不保留该目录。

## 目标系统设计

计划中的产品边界见 [`docs/design-docs/product-boundary.md`](docs/design-docs/product-boundary.md)，已确认的对象与职责见 [`docs/design-docs/system-boundaries.md`](docs/design-docs/system-boundaries.md)，实施顺序见 [`docs/exec-plans/active/symphoneer-v1.md`](docs/exec-plans/active/symphoneer-v1.md)。只有上文列出的 Issue #13 模块有实现证据；其余目标结构继续是计划。
