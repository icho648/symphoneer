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
- 当前阶段只讨论架构和 Markdown；不要自行安装依赖、创建应用代码或声称真实运行已验证。
- 代码出现后，再根据真实模块和失败模式增加结构测试、CI、生成物和局部 `AGENTS.md`。

<!-- agent-guidance:core:version=1.0.0:start -->
## Agent 工程工作流

### 工作流变速箱

工作流变速箱是一套任务分级规则，不是额外工具。开始工程任务时，选择足以安全完成工作的最低挡位；不要给简单任务增加不必要的仪式。当范围、不确定性、持续时间或协作需求上升时，主动升挡。

- **G1 直接执行**：任务局部、明确、低风险。完成修改并运行相关验证。
- **G2 先规划**：任务复杂、含糊或涉及多个关联部分。先探索和澄清，再形成可审查的计划；当前代理支持 Plan mode 时，按照该产品的方式使用或建议用户启用。
- **G3 ExecPlan**：任务可能持续数小时、跨越多个模块或会话、需要中断恢复，或具有显著技术未知。开始实现前必须完整读取仓库根目录的 `PLANS.md`，并创建、持续维护任务专属的 ExecPlan。路径遵循项目已有约定；没有约定时使用 `plans/<task-slug>.md`。
- **G4 规格治理**：需求需要持久产品规格、多人批准、审计记录或跨团队协调。使用项目已经采用的 SDD、OpenSpec、Spec Kit 或等价流程；不要未经用户同意安装新的治理系统。

执行过程中发现当前挡位不足时，暂停当前实现并升挡。任务缩小时可以减少后续仪式，但不得丢失已经形成的决定、验证证据或恢复信息。

### 验证后再声明完成

在声称修复、实现、测试或任务完成前，运行与该声明直接相关的最新验证，并报告实际命令和结果。不得用推测、旧输出或“应该可以”代替证据。

### 根因优先调试

遇到缺陷、测试失败或异常行为时，先稳定复现并定位根因，再修改实现。不要在没有验证假设的情况下连续尝试补丁。
<!-- agent-guidance:core:version=1.0.0:end -->
