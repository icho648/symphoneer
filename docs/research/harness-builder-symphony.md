# Harness Builder 与 Symphony：一手资料边界

核验日期：2026-07-30  
范围：OpenAI Harness Engineering、OpenAI Symphony、QoderAI Better Harness。

> **Decision（2026-08-01，已取代）：** 本文只保留为 Harness 与 Symphony 衔接的历史
> 调研输入。旧的“Harness Builder / 可选 Harness Workshop”产品增强形态已从当前
> 设计中移除，不再建模为产品对象。以
> [`product-boundary.md`](../design-docs/product-boundary.md) 与
> [`index.md`](index.md) 为准；下文中的 Workshop / Builder 叙述均属历史方案，
> 不代表现行范围。

## 结论

`Harness Builder` 有真实产品空位，但不应重做 Codex Agent Loop 或
Symphony 调度器。合理边界是：

- Better Harness 提供诊断与证据模型；
- Harness Builder 把缺口转成仓库内、可审核和可验证的 Harness 变更；
- Symphony 在变更启用后持续派发任务并产生新的运行证据；
- Git 是 Harness 的事实源，任务系统是工作的事实源，界面只是投影。

## 已观察事实

### Harness Engineering

OpenAI 将项目 Harness 描述为一组仓库内机制，而非单独框架：短
`AGENTS.md`、结构化文档、执行计划、项目原生测试、浏览器操作、
日志/指标/追踪、架构 lint、CI、Review 与持续清理。仓库被当作
系统记录，规则尽量被机械验证。

来源：[Harness engineering](https://openai.com/index/harness-engineering/)

### Better Harness

Better Harness 的公开定位是审查编码 Agent 的外层工作流。它收集
项目与会话证据，评价任务理解、受控执行、变更验证、可靠交付和
经验沉淀，并生成带证据、修复边界和验收路径的 finding/report。
它明确区分机制存在与机制在真实任务中被使用或改善结果。

它包含有限的修复规划/动作，但公开主流程仍是
`review -> report -> scoped repair`，不是 issue 调度器、Agent runtime
或项目 Harness 的统一生成器。

来源：

- [Better Harness README](https://github.com/QoderAI/better-harness)
- [Better Harness architecture](https://github.com/QoderAI/better-harness/blob/main/docs/ARCHITECTURE.md)

### Symphony

Symphony 不是“没有代码”。当前仓库包含：

- Draft v1、语言无关的服务规范；
- 一个 Elixir/OTP 参考实现；
- `WORKFLOW.md` 示例、Dashboard/JSON API 和多个 tracker adapter。

不过，OpenAI 明确把它定位为 intentionally minimal 的参考实现，
不计划把它作为独立产品维护；Elixir README 也标记其为 evaluation
prototype，并建议生产使用者按规范实现加固版本。

来源：

- [Symphony repository](https://github.com/openai/symphony)
- [Symphony SPEC](https://github.com/openai/symphony/blob/main/SPEC.md)
- [Elixir reference implementation](https://github.com/openai/symphony/blob/main/elixir/README.md)
- [OpenAI Symphony article](https://openai.com/index/open-source-codex-orchestration-symphony/)

规范中的明确边界：

- Symphony 是 tracker reader、scheduler 和 runner；
- 它为每个 issue 创建隔离 workspace，通过 Codex App Server 执行；
- 工作流策略和运行参数放在版本化的 `WORKFLOW.md`；
- rich web UI、多租户 control plane、通用 workflow engine 和业务 ticket
  写入逻辑都是非目标；
- Dashboard 是可选状态面，规范给出 `/api/v1/state`、单 issue 详情和
  refresh 接口；
- 调度状态主要在内存中，重启后依靠 tracker 与保留 workspace 恢复，
  不是历史证据数据库；
- worktree/workspace 隔离不替代 sandbox 和审批策略。

## 合理衔接

`WORKFLOW.md` 只是项目 Harness 的一个消费者和编排策略，不是整个
Harness。Harness Builder 应维护的对象还包括 `AGENTS.md`、项目文档、
Skills、Hooks、原生检查命令、CI、架构约束和可观测能力。

最小闭环：

```text
真实任务运行
  -> 任务证据或重复失败
  -> Harness finding
  -> 仓库 patch / PR
  -> 项目原生验证 + 人工批准
  -> 合并并启用新的 Harness revision
  -> Symphony 用新 revision 执行后续任务
  -> 比较新的 Task Episode
```

一个产品可以同时呈现 Harness 改进和 Symphony 运行状态，但两者不应
共享一个含混状态机：

- Harness 变更状态：Observed -> Proposed -> In PR -> Verified -> Active；
- 工作执行状态：tracker state + Symphony running/retrying/blocked；
- 每次运行额外记录 `issue_id`、attempt、Codex thread/turn 与
  `harness_revision`，用于把结果归因到实际启用的 Harness。

## 未验证与风险

- 未在本地实际运行 Symphony Elixir 参考实现。
- 未验证参考实现所有 tracker adapter、Dashboard API 和 Codex
  App Server 版本组合。
- Better Harness 的跨宿主证据与 mutation 覆盖仍会随版本变化；采用时
  应固定版本并做 host smoke。
- 自动修改 `WORKFLOW.md`、权限、sandbox、CI 或 merge policy 会影响
  后续全部任务，应经过 PR 和人工批准，不应由正在运行的 Symphony
  直接自修改并自动启用。
