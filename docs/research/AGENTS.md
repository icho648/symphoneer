# Research — Agent Map

这里保存带日期的调研快照、外部文章分析和历史方案。它们是证据输入，不是自动生效的产品决定；只读取当前任务需要的快照。

## 快照目录

| 文档 | 当前作用 | 与规范性设计的关系 |
|---|---|---|
| [AI Coding 工程化：个人项目的组件边界](2026-07-30-AI-Coding工程化_个人项目边界.md) | Evidence / Harness / MCP / Phoenix 的**规模触发条件** | 旧 Delivery Plugin 形态已取代；以 [`../core-concepts/product-boundary.md`](../core-concepts/product-boundary.md) 为准 |
| [Agent Orchestrator、Conductor 与 Symphoneer](2026-07-30-agent-orchestrator-conductor-vs-symphoneer.md) | 竞品事实对比与“不能再主打”清单 | 支持产品差异分析；Sidecar 旧建议已否决 |
| [Codex 编排控制面与 Symphoneer 映射](2026-08-01-Codex编排控制面与Symphoneer映射.md) | 第三方文章的对象映射与控制词汇 | 非官方；并发细节以 08-10 concurrency 为准 |
| [Anthropic 长时运行 Agent Harness](2026-08-02-anthropic-long-running-agent-harness.md) | 渐进上下文、增量任务、交接与恢复 | 支持项目 Harness；Planner / Evaluator / 多 Agent 不进产品范围 |
| [桌面开发工具的项目存储与 Worktree 生命周期](2026-08-08-desktop-project-storage-worktree-lifecycle.md) | Electron / VS Code / Codex / Git 一手存储与 worktree 证据 | 支持 [`../core-concepts/system-boundaries.md`](../core-concepts/system-boundaries.md)；已吸收的 Host 决定不在此复述 |
| [OpenAI Symphony 的产品表面与对话边界](2026-08-09-openai-symphony-product-surface.md) | 固定 commit：调度守护进程、状态面、Verification / Blocked / 重试 / PR | 支持 product-boundary 与 system-boundaries |
| [OpenAI Symphony Workspace 布局与清理](2026-08-09-openai-symphony-workspace-layout.md) | 固定 commit：Issue Workspace、复用、清理、cwd | 校准 system-boundaries；Codex Desktop 细节指针到 08-08 |
| [Codex App Server 同一 Thread 的并发与写入顺序](2026-08-10-codex-app-server-concurrency.md) | Turn / FIFO / 多客户端 / 跨进程风险 | 支持 Runtime 单写者与交接设计 |
| [Codex App Server 与 Pi 的活动归一化边界](2026-08-10-codex-pi-activity-normalization.md) | 可共享展示活动 vs Provider 生命周期差异 | 只支持第二个真实 Adapter 时提取共同值对象 |
| [Codex App Server 可观测性边界](2026-08-14-codex-app-server-observability.md) | App Server 事件、Token、OTel、Prompt / Reasoning 与 Trace 关联边界 | 支持可选 Trace；不把内部事件当完整 Provider payload |
| [Executor 可观测性能力矩阵](2026-08-14-executor-observability-matrix.md) | Codex / Claude / Cursor / Pi 的事件、Token、工具与 OTel 边界 | 支持 Executor 与 Phoenix 选型；不自动形成采用决定 |
| [面向个人开发者的产品机会](2026-08-14-personal-developer-product-opportunities.md) | Attention、Review、反馈闭环与恢复能力的优先级输入 | 支持下一增量选择；不自动改变产品边界或形成实现授权 |
| [个人开发者的可信 AI 交付证据体系](2026-08-14-delivery-assurance-evidence.md) | Midscene、UI artifact、Patch coverage 与补充测试手段的证据边界 | 支持可信交付协议讨论；不自动形成 Gate 或实现授权 |
| [Codex Worktree 命名边界](2026-08-11-codex-worktree-naming.md) | App managed worktree / branch / chat name 的官方事实边界 | 命名讨论证据；不直接形成产品决定 |
| [Symphoneer / OpenAI Symphony Conformance 快速审计](2026-08-12-symphoneer-symphony-conformance-audit.md) | 固定官方 main 与当前本地生产接线的差距矩阵 | 研究输入；不自动更新产品或系统边界 |
| [OpenAI Symphony 与 Symphoneer 的持久化边界](2026-08-18-symphony-persistence-boundary.md) | 官方 Tracker/Workspace 恢复与本地 JSONL 历史投影的边界 | 研究输入；不把 JSONL 误写成固定 Symphony SPEC |

## 局部规则

- 每份快照记录来源、核验日期和 `Observed` / `Not verified` 状态，并链接支持或质疑的规范性文档。
- 新资料新增日期快照，不覆盖历史判断；结论被接受时更新 `core-concepts/` 或移动到 `decisions/`，不能只停留在 Research。
- 已被更新快照、核心概念或决定**完全吸收**且没有独特证据的旧文档直接删除；有独特一手证据时才保留日期链。
- 新增、删除或 stub 快照时更新本文件。
