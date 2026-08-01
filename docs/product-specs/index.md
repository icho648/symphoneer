# Product Specs

本目录定义用户能做什么、看到什么以及何时算完成。当前只保留一条端到端人工基线；未来界面不提前创建空壳规格。

## 当前规格

| 文档 | 用户结果 | Decision status | Implementation evidence |
|---|---|---|---|
| [manual-delivery-flow.md](manual-delivery-flow.md) | 从一个 GitHub Issue 走到可审查证据和人工决定 | Accepted | Not verified |

## 后续候选

| 议题 | 何时创建规格 |
|---|---|
| New User Onboarding | 首次运行前置条件在真实实现中出现后 |
| Task Board | Web-first 闭环产生可观察的真实状态后 |
| Run Inspector | 已有真实 App Server 事件和验证证据后 |
| Human Handoff | Codex App 深链、暂停和恢复完成 Smoke 后 |
| MCP Surfaces | 受控操作的契约、幂等与 Host 确认完成验证后 |

Web Dashboard 和受控 MCP 的产品方向已确认，但尚无真实事件、界面或兼容性证据。先让 [`manual-delivery-flow.md`](manual-delivery-flow.md) 的对象、失败路径和验收在真实闭环中成立，再拆分界面规格。Harness 保持项目开发基建，不创建产品规格。
