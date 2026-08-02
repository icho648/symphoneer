# Symphony Workbench — Agent Map

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

## ExecPlan 触发

- 多小时任务、重大重构或进入应用实现前，先完整阅读 `docs/PLANS.md`，再创建或更新一个自包含的 active ExecPlan。
- 小型文档修订、单个事实核对和索引修复不创建 ExecPlan。
- active ExecPlan 必须持续记录进度、发现、决定、验证和恢复方式；静态愿望清单不属于 `active/`。

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
- 当前阶段只讨论架构和 Markdown；不要自行创建应用代码、产品依赖或声称产品运行时已验证。
- 允许维护文档开发环境入口：`scripts/docs-check.sh`、`scripts/docs-preview.sh` 与 `.cursor/environment.json`。
- 代码出现后，再根据真实模块和失败模式增加结构测试、CI、生成物和局部 `AGENTS.md`。
