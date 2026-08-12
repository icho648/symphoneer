# Symphoneer — Agent Map

这是仓库级 Agent Interface，不是完整设计说明。先按任务读取最小入口，再进入必要叶子文件；不要递归加载整个 `docs/`。

## 读取路由

| 任务 | 先读 | 再按需读取 |
|---|---|---|
| 人类项目介绍与 README 维护 | `README.md` | `docs/design-docs/product-boundary.md`、`ARCHITECTURE.md` |
| 产品定位与非目标 | `docs/design-docs/product-boundary.md` | `docs/design-docs/system-boundaries.md` |
| 当前阶段、当前增量与验收 | 关联 GitHub Issue | `docs/plans/AGENTS.md`；仅在存在 active plan 时读取对应计划 |
| 当前物理结构与依赖 | `ARCHITECTURE.md` | 当前 Module 源码与测试 |
| 人用 CLI / TUI | `src/cli/AGENTS.md` | `ARCHITECTURE.md`、`docs/design-docs/product-boundary.md` |
| 产品、架构、规格或外部契约 | `docs/AGENTS.md` | 表中对应叶子文档 |
| 调研输入与历史方案 | `docs/research/AGENTS.md` | 对应日期快照 |
| 复杂任务与执行计划 | `docs/plans/AGENTS.md` | 仅在任务需要本地恢复上下文时读取 `docs/plans/active/` |
| 实现结构、测试与工程约束 | 关联 GitHub Issue；若存在则读取 active plan | `ARCHITECTURE.md`、`docs/design-docs/core-beliefs.md`、`docs/design-docs/system-boundaries.md` |

## 工作规则（执行主线）

**先读实时事实和授权范围，做最小改动，围绕同一验收目标验证，最后把结果写回事实源。**

- GitHub Issue 是 Issue-driven 增量的目标、范围、依赖、验收和授权事实源；只有 Issue 不完整，或需要跨轮恢复、危险操作记录、外部重试或跨 Issue 协调时，才使用 `docs/plans/AGENTS.md` 规定的 active plan。小型文档修订、事实核对和索引修复不创建计划。
- 每次只推进一个可判定增量；实现、检查和证据必须对应同一验收目标。
- Issue、PR、依赖、评论、分支、工作树和测试结果都是实时事实；开始、恢复、合并和外部写入前直接读取，不使用计划或 README 的缓存状态。
- 停止时把进度、失败、决定和验证写回 Issue/PR；active plan 只补充 Issue 未承载的本地恢复信息，不复制 Issue 内容。
- Planner、Evaluator 或多 Agent Harness 可以辅助开发，但不是 Symphoneer 的产品对象、状态或 V1 功能。

## 证据与状态

- 文档级状态分开写：`Decision status` 表示是否确认，`Implementation evidence` 表示是否有真实实现或运行证据。
- 具体声明使用 `Observed`、`Decision`、`Proposed`、`Not verified`、`Out of scope`。
- Agent 自述、静态文档和计划不能证明真实运行、兼容性、质量或交付完成。

## 工程约束

- `README.md` 只维护面向人的稳定项目介绍和入口；当前阶段、授权范围与验收由关联 Issue 决定，V1 跨 Issue 顺序可由 active plan 作为协调索引，不在 README 复制进度。
- 修改文档导航或局部规则时，更新 `docs/AGENTS.md` 或最近的局部 `AGENTS.md`；只有人类入口发生变化时才更新 `README.md`。
- 只实现当前关联 Issue 明确授权的 Module、Seam 与验收；active plan 只能补充本地恢复约束，不能扩大 Issue 范围，也不为后续阶段预装依赖或搭空结构。
- 测试只证明同一验收目标的关键可观察行为：先查现有覆盖，只补最小正向或高风险失败场景，不为数量、覆盖率或内部实现凑用例。
- 新行为或 Bug 修复先让验收测试在旧实现上失败；通过公共 Module Interface 验证，Mock 只用于外部边界，最终运行 `pnpm check`。若没有新行为或已有覆盖足够，说明不新增测试。
- 目标仓库不保存软件运行数据；详细存储责任见 `docs/design-docs/system-boundaries.md`。
- 顶层先按稳定 Module 分类；多文件功能统一放进同名目录，内部再按业务行为或生命周期聚类。行为私有内容跟随行为；只有共享不变量留在 Module 根，避免无边界的 `utils/`、`helpers/`、`types/` 桶。
- 代码目录存在清晰入口时可以使用 `index.ts`：Module 根只暴露稳定 Interface，功能目录可以承载主行为或顶层编排，但不得隐藏导入副作用或无差别暴露内部文件。
- 文档默认由 `docs/AGENTS.md` 路由；只有内容较多、存在局部规则或需要按需加载时才增加最近层级的 `AGENTS.md`，不创建纯转发 `index.md`。
- 手写代码文件以约 120 行作为软性 review threshold，不作为 CI 门禁。超过时优先按稳定职责拆分；若拆分只会制造浅层转发、暴露内部状态或破坏局部性，可以保留并在审查或 active plan（如有）中记录理由。
- 测试目录可以按用户可观察行为镜像源码分类，但通过 Module Interface 验证结果，不与每个内部文件机械一一对应。

## Cursor Cloud specific instructions

- 仓库为单一 pnpm 工作区，源码在 `src/*`（`link:` workspace：`contracts`、`runtime`、`runtime-client`、`mcp`、`cli`、`web`），测试在 `tests/`。可运行组件有三个：Runtime（`src/runtime/serve.ts`，HTTP 服务，默认 `127.0.0.1:4318`，可同源托管 Vite UI）、Web（Vite SPA，`src/web`，开发默认 `127.0.0.1:3000`）与 MCP（`src/mcp/stdio.ts`，STDIO）。命令一律以 `package.json` 的 `scripts` 为准，不在此重复。
- 本地起服务：`pnpm dev` 会同时拉起 Runtime 与 Vite；未显式设置时，开发数据保存在 macOS `~/Library/Application Support/Symphoneer/Development/`（其他平台为 `~/.symphoneer/development/`），并自动设置 `SYMPHONEER_RUNTIME_TOKEN`。也可分别用 `pnpm runtime:serve`（需自行设 `SYMPHONEER_DATA_DIR`）和 `pnpm web:dev`。MCP 由 Host 按需 `pnpm mcp:serve`，不要塞进 `dev` 前台进程。健康检查 `GET /healthz`（Runtime）；CLI 查询 `pnpm runtime:cli snapshot|events|attempt <id>`。常用环境变量：`SYMPHONEER_RUNTIME_HOST/PORT`、`SYMPHONEER_WEB_HOST/PORT`、`SYMPHONEER_RUNTIME_URL`、`SYMPHONEER_RUNTIME_TOKEN`、`SYMPHONEER_DATA_DIR`、`SYMPHONEER_UI_DIST_DIR`。
- Node 版本：`package.json` engines 为 `>=22.18.0`，`.nvmrc` 固定 `22.18`。`node --test` 直接执行 `.ts`、`import.meta.main`、`Promise.withResolvers` 均要求 Node ≥22.18；系统自带的 `/exec-daemon/node` 是 v22.14（过旧，测试会 `ERR_TEST_FAILURE`）。pnpm 由 corepack 提供（`pnpm@11.15.1`）。
- 本环境已按 `.nvmrc` 把 Node 22.18 设为默认：`/usr/local/cargo/bin` 放了指向 nvm v22.18 的 `node`/`npx` symlink（排在 `/exec-daemon` 之前），并在 `~/.bashrc` 前置 nvm default 的 bin。因此普通（非登录）shell 里 `node --version` 也应是 v22.18；若意外是 v22.14，执行 `nvm use default` 或直接用 `$(nvm which default)`。
- `pnpm check` 依次运行 Biome、`tsc --noEmit`、`scripts/check-project.mjs`、`node --test tests/**/*.test.ts`、以及 `check:web`（`vite build`）。`check-project.mjs` 会强制：`*.test.ts`/`*.spec.ts` 必须位于 `tests/` 下；Markdown 本地链接有效；`docs/**` 叶子文档被最近的 `AGENTS.md` 索引；`docs/plans/active/*.md` 含固定 12 个 ExecPlan 小节；Runtime 不得依赖 Web/Vite/`runtime-client`，Web/MCP/CLI 只能经 `@symphoneer/runtime-client` 访问 Runtime，且 Web 不得再 import Next.js。此类失败属预期约束，非环境问题。
