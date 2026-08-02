# Codex App Server

> External source status: Official source locator observed 2026-08-01  
> Project adoption: Accepted as the first Agent Runtime  
> Implementation evidence: Not verified

## 核验入口

- [Codex App Server source](https://github.com/openai/codex/tree/main/codex-rs/app-server)
- [Codex documentation](https://developers.openai.com/codex/)

## Symphoneer 采用边界

- `Thread` 是 Agent 的持久上下文，包含多个 `Turn`；`Item` 是消息、命令、编辑和工具事件等运行单元。
- `Thread` 使用 Symphony `Workspace` 的路径执行，但不拥有目录、分支、所有权或回收生命周期。
- Symphoneer V1 将 `threadId` / `turnId` 作为 Attempt 的运行引用；默认一个 Task 的一次 Attempt 关联一个活跃 Agent Session。
- 同一 Task 多 Thread 的并行聚合、子 Agent 的业务状态和独立合并证据不属于当前 V1；需要真实需求和新的 Symphoneer 契约。

## 实现前必须固定的契约

- 实现时使用本地 Codex CLI 的 App Server schema generation 能力生成 TypeScript 契约，不手写可漂移的 Thread、Turn、Item、事件和 Review Schema。
- 初始化、工具调用、等待、取消、恢复和 cursor 的实际行为。
- 权限、sandbox、审批和凭据的宿主边界。
- Codex App 与 App Server 之间是否存在可用的 Thread 深链、暂停、恢复和交还能力。

当前只接受了首版 Runtime 和生成契约的方向；没有将生成产物写入仓库，也没有本地 Smoke，因此任何具体方法、字段和兼容性声明均为 `Not verified`。
