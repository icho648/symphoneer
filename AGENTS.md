# Symphoneer — Agent Map

这是本项目的 Agent 导航文件，不是完整设计说明。按当前任务选择一个入口，只读取对应索引和必要叶子文档；不要递归加载整个 `docs/`。

## 读取路由

| 任务 | 先读 | 再按需读取 |
|---|---|---|
| 项目定位与当前阶段 | `README.md` | `docs/design-docs/product-boundary.md` |
| 核心原则、事实源与职责 | `docs/design-docs/index.md` | `core-beliefs.md`、`system-boundaries.md` |
| 用户可观察流程与验收 | `docs/product-specs/index.md` | `manual-delivery-flow.md` |
| 外部契约与采用边界 | `docs/references/index.md` | 对应来源文档 |
| 调研输入与历史方案 | `docs/research/index.md` | 对应日期快照 |
| 复杂任务与执行计划 | `docs/PLANS.md` | `docs/exec-plans/active/` 中的对应计划 |
| 实现结构、测试与工程约束 | 对应 active ExecPlan | `docs/design-docs/core-beliefs.md`、`docs/design-docs/system-boundaries.md` |

## ExecPlan 触发

- 多小时任务、重大重构或进入应用实现前，先完整阅读 `docs/PLANS.md`，再创建或更新一个自包含的 active ExecPlan。
- 小型文档修订、单个事实核对和索引修复不创建 ExecPlan。
- active ExecPlan 必须持续记录进度、发现、决定、验证和恢复方式；静态愿望清单不属于 `active/`。

## 项目 Harness

本项目的 Harness 是仓库内的渐进式工作上下文，不是产品 Runtime 的一部分：

```text
AGENTS.md
├─ 路由到 design docs / product specs / references / research
├─ 复杂任务进入 docs/PLANS.md
└─ active ExecPlan
   ├─ 当前增量任务和明确下一步
   ├─ Progress / Discoveries / Decisions
   ├─ 可恢复交接状态
   └─ 可执行验收和真实证据
```

- 开始或恢复复杂任务时，先确认工作树状态，读取 active ExecPlan 和当前增量涉及的事实源，不递归加载无关文档。
- 每次只推进一个可判定的增量；实现、检查和证据必须对应同一验收目标。
- 停止前更新完成项、未完成项、发现、决定、已运行命令、失败信息、明确下一步和安全恢复方式。
- Planner、Evaluator 或多 Agent Harness 可以辅助开发，但不是 Symphoneer 的产品对象、状态或 V1 功能。

## 事实源边界

- `docs/design-docs/`：确认后的产品与架构决定。
- `docs/product-specs/`：用户可观察行为和验收条件。
- `docs/references/`：外部契约、采用边界和核验入口。
- `docs/research/`：带日期的分析输入；不能自动覆盖设计决定。
- `docs/exec-plans/`：一项复杂工作的执行状态和历史；不是产品事实源。

## 证据与状态

- 文档级状态分开写：`Decision status` 表示是否确认，`Implementation evidence` 表示是否有真实实现或运行证据。
- 具体声明继续使用 `Observed`、`Decision`、`Proposed`、`Not verified`、`Out of scope`。
- Agent 自述、静态文档和计划不能证明真实运行、兼容性、质量或交付完成。

## 工作规则

- 修改或新增文档时，更新所属分区的 `index.md`；只有人类入口发生变化时才更新 `README.md`。
- 研究材料必须链接到它支持或质疑的设计文档；外部契约记录来源和核验日期。
- 当前已进入 active ExecPlan 的增量实现阶段；只实现当前关联 Issue 明确授权的 Module、Seam 和验收，不为后续阶段预装依赖或搭空结构。
- 代码改动必须增加与同一验收目标对应的根 `tests/` 测试并通过 `pnpm check`。真实 GitHub、Codex、Runtime、Web、MCP、fixture、Phoenix 或部署行为在匹配 Smoke 前继续标为 `Not verified`。
- 手写代码文件以约 120 行作为软性 review threshold；超过时可以按稳定职责拆分。一个功能一旦拆成多个文件，应统一放进同名目录（如 `scheduler/`、`workspace/`），并用目录内的 `index.ts` 保持单一公开 Interface。
- 120 行不是 CI 门禁。若拆分只会制造浅层转发、暴露内部状态或破坏同一状态机的局部性，可以保留较长文件，并在审查或 active ExecPlan 中记录理由。
