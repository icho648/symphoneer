# Research — Agent Map

这里保存带日期的调研快照、外部文章分析和历史方案。它们是证据输入，不是自动生效的产品决定；只读取当前任务需要的快照。

## 快照目录

| 文档 | 当前作用 | 与规范性设计的关系 |
|---|---|---|
| [AI Coding 工程化：个人项目的组件边界](2026-07-30-AI-Coding工程化_个人项目边界.md) | Evidence / Harness / MCP / Phoenix 的**规模触发条件** | 旧 Delivery Plugin 形态已取代；以 [`../design-docs/product-boundary.md`](../design-docs/product-boundary.md) 为准 |
| [Agent Orchestrator、Conductor 与 Symphoneer](2026-07-30-agent-orchestrator-conductor-vs-symphoneer.md) | 竞品事实对比与“不能再主打”清单 | 支持产品差异分析；Sidecar 旧建议已否决 |
| [OpenAI Symphony 的运行时边界](2026-07-30-symphony-runtime-boundaries.md) | **Stub**：早期定位已被 08-09 快照取代 | 改读 product-surface / workspace-layout 与 [`../references/symphony-spec.md`](../references/symphony-spec.md) |
| [Codex 编排控制面与 Symphoneer 映射](2026-08-01-Codex编排控制面与Symphoneer映射.md) | 第三方文章的对象映射与控制词汇 | 非官方；并发细节以 08-10 concurrency 为准 |
| [Anthropic 长时运行 Agent Harness](2026-08-02-anthropic-long-running-agent-harness.md) | 渐进上下文、增量任务、交接与恢复 | 支持项目 Harness；Planner / Evaluator / 多 Agent 不进产品范围 |
| [多语言与主题适配结构](2026-08-04-i18n-theme-structure.md) | Web locale / 主题 Decision（Vite） | 实现在 `src/web/i18n`；不支撑 product/system 边界 |
| [桌面开发工具的项目存储与 Worktree 生命周期](2026-08-08-desktop-project-storage-worktree-lifecycle.md) | Electron / VS Code / Codex / Git 一手存储与 worktree 证据 | 支持 [`../design-docs/system-boundaries.md`](../design-docs/system-boundaries.md)；已吸收的 Host 决定不在此复述 |
| [OpenAI Symphony 的产品表面与对话边界](2026-08-09-openai-symphony-product-surface.md) | 固定 commit：调度守护进程、状态面、Verification / Blocked / 重试 / PR | 支持 product-boundary 与 system-boundaries |
| [OpenAI Symphony Workspace 布局与清理](2026-08-09-openai-symphony-workspace-layout.md) | 固定 commit：Issue Workspace、复用、清理、cwd | 校准 system-boundaries；Codex Desktop 细节指针到 08-08 |
| [Codex App Server 同一 Thread 的并发与写入顺序](2026-08-10-codex-app-server-concurrency.md) | Turn / FIFO / 多客户端 / 跨进程风险 | 支持 Runtime 单写者与交接设计 |
| [Codex App Server 与 Pi 的活动归一化边界](2026-08-10-codex-pi-activity-normalization.md) | 可共享展示活动 vs Provider 生命周期差异 | 只支持第二个真实 Adapter 时提取共同值对象 |
| [Codex Worktree 命名边界](2026-08-11-codex-worktree-naming.md) | App managed worktree / branch / chat name 的官方事实边界 | 命名讨论证据；不直接形成产品决定 |
| [Symphoneer / OpenAI Symphony Conformance 快速审计](2026-08-12-symphoneer-symphony-conformance-audit.md) | 固定官方 main 与当前本地生产接线的差距矩阵 | 研究输入；不自动更新产品或系统边界 |

## 局部规则

- 每份快照记录来源、核验日期和 `Observed` / `Not verified` 状态，并链接支持或质疑的规范性文档。
- 新资料新增日期快照，不覆盖历史判断；结论改变时更新对应 `design-docs/`，不能只停留在 Research。
- 已被更新快照或 design-doc **完全吸收**的旧长文，应收成 stub 或删掉重复段，保留独特一手证据与日期链。
- 新增、删除或 stub 快照时更新本文件。
