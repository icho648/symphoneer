# Anthropic 长时运行 Agent Harness 研究快照

> 核验日期：2026-08-02
>
> Observed source：已核验三篇 Anthropic Engineering 官方文章
>
> Project adoption：采纳其中的项目级工作习惯；不采纳其产品拓扑
>
> Implementation evidence：Not verified

本文是带日期的研究输入，不自动覆盖设计决定、产品规格或执行状态。它回答的是：
Symphoneer 的整个项目 Harness 应吸收哪些长任务开发习惯，而不是给产品增加哪些 Agent。

## 来源与标题对应

| 用户给出的标题 | 2026-08-02 官方当前标题与日期 | 当前官方 URL | 核验结果 |
|---|---|---|---|
| Effective harnesses for long-running agents | *Effective harnesses for long-running agents*，2025-11-26 | [Anthropic Engineering](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) | 标题一致 |
| Effective context engineering for AI agents | *Effective context engineering for AI agents*，2025-09-29 | [Anthropic Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | 标题一致 |
| Harness design for long-running application development | *Harness design for long-running application development*，2026-03-24 | [Anthropic Engineering](https://www.anthropic.com/engineering/harness-design-long-running-apps) | 标题一致；URL 使用缩写 `long-running-apps` |

未能核验的标题：无。

## Observed source

1. **渐进加载优于一次性灌入全部上下文。** Anthropic 把上下文视为有限注意力预算，建议保留最小的高信号信息，并用文件路径、链接等轻量标识按需检索；这种 just-in-time retrieval 让 Agent 逐层发现相关上下文，即 progressive disclosure。[来源](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
2. **长任务需要可恢复的外部状态。** 早期长任务 Harness 让首个会话准备环境，后续会话一次推进一个功能，并用进度文件与 Git 历史留下结构化交接，避免新会话猜测前序工作。[来源](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
3. **每次启动先重新定向，再继续实现。** Anthropic 的示例先确认工作目录，读取 Git 历史、进度和待办，启动应用并跑基本端到端检查；发现基线已坏时先恢复，而不是继续叠加改动。[来源](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
4. **完成条件应是可执行行为。** 早期实验把功能写成端到端步骤，只有实际测试后才改变通过状态；后续 Harness 在每个工作块开始前约定可测试的完成条件，并让运行中的应用接受交互检查。[来源一](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) · [来源二](https://www.anthropic.com/engineering/harness-design-long-running-apps)
5. **生成者自述不能充分证明质量。** 后续实验发现自评容易过度乐观，把执行和检查分开能发现真实缺口；同时 Evaluator 仍需校准，也会漏掉问题，不能被当作绝对验证器。[来源](https://www.anthropic.com/engineering/harness-design-long-running-apps)
6. **Harness 复杂度必须随模型和任务重新证明。** Anthropic 后续移除了已经不再必要的 context reset 和 sprint 结构，并建议在模型变化后删除不再承载价值的组件；Planner、Evaluator 与多 Agent 是实验选择，不是通用必需条件。[来源](https://www.anthropic.com/engineering/harness-design-long-running-apps)

## Project adoption

Symphoneer 采纳上述工程习惯，作用范围是整个仓库的开发 Harness：

这些采用决定的规范性落点是 [Core Beliefs](../design-docs/core-beliefs.md) 中的 Progressive disclosure、Deep seams 与 Operationally separate；根 `AGENTS.md`、`docs/AGENTS.md`、[`plans/AGENTS.md`](../plans/AGENTS.md) 和 active plan 负责执行导航与交接，不产生新的产品状态。

```text
AGENTS.md
└─ docs/AGENTS.md
   ├─ 路由设计、规格与外部契约
   ├─ research/AGENTS.md 按需加载日期快照
   └─ plans/AGENTS.md
      └─ active plan
      ├─ 当前增量任务与下一步
      ├─ Progress / Discoveries / Decisions
      ├─ 恢复上下文与未解决问题
      └─ 可执行验收、证据与 Not verified
```

| 习惯 | 在 Symphoneer 项目 Harness 中的落点 |
|---|---|
| 渐进上下文加载 | 根 [`AGENTS.md`](../../AGENTS.md) 只做仓库路由，[`docs/AGENTS.md`](../AGENTS.md) 路由少量规范叶子；Research 与 Plans 只在任务进入对应目录时加载局部 `AGENTS.md`。这对应 Anthropic 的高信号最小上下文和 progressive disclosure。[来源](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) |
| 增量任务 | [`plans/AGENTS.md`](../plans/AGENTS.md) 要求复杂工作按可独立验收的最小增量推进；active plan 在任一时刻明确当前增量、完成条件和紧接着的一步，避免一次处理整个产品。[来源](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) |
| 进度与恢复交接 | 每个停点更新 active ExecPlan 的 `Progress`、`Surprises & Discoveries`、`Decision Log`、`Idempotence and Recovery` 与最小证据，记录工作树状态、已执行检查、失败、未验证项和下一步；聊天记录不是恢复所需的唯一上下文。[来源](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) |
| 启动时重新定向 | 继续复杂任务时，先按 `AGENTS.md` 定位事实源，核对 Git 状态与 Diff，读取 active ExecPlan 的最新进度和下一步；代码出现后，再运行最小可执行基线检查，基线失败时先恢复。[来源](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) |
| 可执行验收 | 用户可观察结果写入 `docs/product-specs/`；ExecPlan 把它落实为准确命令、工作目录、预期结果和失败判定。只有实际执行结果才能更新证据状态，计划中的命令不能冒充通过。[来源](https://www.anthropic.com/engineering/harness-design-long-running-apps) |
| 独立验证 | 实现 Agent 的完成声明不改变 Verification。后续项目检查应来自仓库真实测试、类型检查、构建、Smoke 或人工操作证据；检查结果独立记录，不要求新增 Evaluator Agent。[来源](https://www.anthropic.com/engineering/harness-design-long-running-apps) |

事实源继续分工：

- `docs/research/` 保存带日期的研究输入，只能支持或质疑决定。
- `docs/design-docs/` 保存确认后的产品与架构决定。
- `docs/product-specs/` 保存用户可观察行为与验收条件。
- `docs/references/` 保存外部契约、采用边界与核验入口。
- `docs/plans/` 保存复杂工作的当前执行状态、恢复信息与证据，不成为产品事实源。

代码出现后，项目检查应从真实模块、已有脚本和已观察失败模式中提炼；本快照不提前发明命令、CI 或测试结构。这保留了 Anthropic 所强调的最小有效 Harness，并允许模型或项目条件变化后删除失去作用的流程。[来源](https://www.anthropic.com/engineering/harness-design-long-running-apps)

## Not adopted

- Planner、Evaluator、Generator 或多 Agent Harness **不成为 Symphoneer 产品功能**；也不据此增加调度状态、界面入口或 Provider 契约。
- 不创建独立 Initializer Agent，也不强制照搬 `feature_list.json`、`claude-progress.txt` 或 `init.sh`；现有 `AGENTS.md`、产品规格、Git 与 active ExecPlan 承担对应职责。
- 不把 context reset、compaction 或 sprint orchestration 固定成仓库规则。Anthropic 的后续实验已显示这些选择依赖模型与任务，并可能变成多余开销。[来源](https://www.anthropic.com/engineering/harness-design-long-running-apps)
- 不用 LLM 评分、Agent 自测或一个综合分数替代确定性检查、真实 Smoke 与 Human Review。Anthropic 也明确观察到 Evaluator 需要反复校准且仍会漏检。[来源](https://www.anthropic.com/engineering/harness-design-long-running-apps)
- 不让本研究快照自动修改设计、规格或 active ExecPlan 的状态。

## Not verified

- 本快照不证明上述流程已经被自动执行、强制检查或在长时间开发中有效。
- 尚未运行真实 Symphoneer Runtime、Coding Agent、项目测试、Smoke 或恢复演练。
- 本轮已把采用边界同步到分层 `AGENTS.md`、规范性设计和 active plan；这只证明文档一致，不证明后续长任务实际遵循或从中受益。
- 后续只有在代码与真实失败模式出现后，才能确定最小项目检查集；在此之前不得把计划中的验收命令标记为已通过。
