# Symphoneer — Agent Map

这是仓库级 Agent Interface，不是完整设计说明。先按任务读取最小入口，再进入必要叶子文件；不要递归加载整个 `docs/`。

## 读取路由

| 任务 | 先读 | 再按需读取 |
|---|---|---|
| 项目定位与当前阶段 | `README.md` | `docs/AGENTS.md`、`docs/design-docs/product-boundary.md` |
| 当前物理结构与依赖 | `ARCHITECTURE.md` | 当前 Module 源码与测试 |
| 产品、架构、规格或外部契约 | `docs/AGENTS.md` | 表中对应叶子文档 |
| 调研输入与历史方案 | `docs/research/AGENTS.md` | 对应日期快照 |
| 复杂任务与执行计划 | `docs/plans/AGENTS.md` | `docs/plans/active/` 中的对应计划 |
| 实现结构、测试与工程约束 | 对应 active ExecPlan | `ARCHITECTURE.md`、`docs/design-docs/core-beliefs.md`、`docs/design-docs/system-boundaries.md` |

## 项目 Harness

- 多小时任务、重大重构或进入应用实现前，按 `docs/plans/AGENTS.md` 创建或更新 active ExecPlan；小型文档修订、单个事实核对和索引修复不创建计划。
- 每次只推进一个可判定增量；实现、检查和证据必须对应同一验收目标。
- 停止前把进度、失败、决定、验证、下一步和恢复方式写回 active ExecPlan。
- Planner、Evaluator 或多 Agent Harness 可以辅助开发，但不是 Symphoneer 的产品对象、状态或 V1 功能。

## 证据与状态

- 文档级状态分开写：`Decision status` 表示是否确认，`Implementation evidence` 表示是否有真实实现或运行证据。
- 具体声明使用 `Observed`、`Decision`、`Proposed`、`Not verified`、`Out of scope`。
- Agent 自述、静态文档和计划不能证明真实运行、兼容性、质量或交付完成。

## 工作规则

- 修改文档导航或局部规则时，更新 `docs/AGENTS.md` 或最近的局部 `AGENTS.md`；只有人类入口发生变化时才更新 `README.md`。
- 只实现当前关联 Issue 和 active ExecPlan 明确授权的 Module、Seam 与验收，不为后续阶段预装依赖或搭空结构。
- 代码改动必须增加与同一验收目标对应的根 `tests/` 测试并通过 `pnpm check`。
- 目标仓库不保存软件运行数据；详细存储责任见 `docs/design-docs/system-boundaries.md`。
- 顶层先按稳定 Module 分类；多文件功能统一放进同名目录，内部再按业务行为或生命周期聚类。行为私有内容跟随行为；只有共享不变量留在 Module 根，避免无边界的 `utils/`、`helpers/`、`types/` 桶。
- 代码目录存在清晰入口时可以使用 `index.ts`：Module 根只暴露稳定 Interface，功能目录可以承载主行为或顶层编排，但不得隐藏导入副作用或无差别暴露内部文件。
- 文档默认由 `docs/AGENTS.md` 路由；只有内容较多、存在局部规则或需要按需加载时才增加最近层级的 `AGENTS.md`，不创建纯转发 `index.md`。
- 手写代码文件以约 120 行作为软性 review threshold，不作为 CI 门禁。超过时优先按稳定职责拆分；若拆分只会制造浅层转发、暴露内部状态或破坏局部性，可以保留并在审查或 active ExecPlan 中记录理由。
- 测试目录可以按用户可观察行为镜像源码分类，但通过 Module Interface 验证结果，不与每个内部文件机械一一对应。
