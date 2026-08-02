# Codex App Server

> External source status: Official protocol README observed 2026-08-02
> Project adoption: Accepted as the first Agent Runtime  
> Implementation evidence: Not verified

## 核验入口

- [Codex App Server protocol README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
- [Codex documentation](https://developers.openai.com/codex/)

## 官方契约观察

- App Server 是用于 Codex 客户端集成的双向 JSON-RPC 协议；默认 stdio 传输是 JSONL。
- 协议以 `Thread / Turn / Item` 表达会话、一次交互和其内部事件，并提供 Thread 创建、继续、分叉、Turn 启动与中断等原语。
- Server 会流式发送生命周期、增量输出、命令、文件变更和审批相关事件；客户端需要处理版本匹配的请求、通知与错误。
- 仓库可生成与当前版本匹配的 TypeScript 类型和 JSON Schema；这些外部类型不应由项目手写猜测。

以上只证明官方协议公开了这些能力，不证明本项目、本机 CLI 或未来 Codex App 版本已经兼容。

## Symphoneer 采用边界

- `Thread` 是 Agent 的持久上下文，包含多个 `Turn`；`Item` 是消息、命令、编辑和工具事件等运行单元。
- `Thread` 使用 Symphony `Workspace` 的路径执行，但不拥有目录、分支、所有权或回收生命周期。
- Symphoneer V1 将 `threadId` / `turnId` 作为 Attempt 的运行引用；默认一个 Task 的一次 Attempt 关联一个活跃 Agent Session。
- Scheduler 只依赖 `startOrContinue`、事件流、`interrupt`、介入响应和 completion 所需的小 Interface；Codex Adapter 内部继续保留原生事件。
- 同一 Task 多 Thread 的并行聚合、子 Agent 的业务状态和独立合并证据不属于当前 V1；需要真实需求和新的 Symphoneer 契约。
- V1 只实现 `CodexAppServerAdapter` 和测试 Fake，不建立 Provider factory、通用事件全集或 capability 注册表。

## 后续可行性，不是采用决定

- [Claude Agent SDK for TypeScript](https://code.claude.com/docs/en/agent-sdk/typescript) 提供流式 `query()` 与可中断的 `Query`；如未来采用，应通过独立 Adapter 接入。
- [OpenCode Server](https://opencode.ai/docs/server/) 提供 HTTP、OpenAPI、SSE 和 Session 接口；如未来采用，应通过 HTTP/SSE Adapter 接入。
- 第二个生产 Adapter 获得明确采用决定后，才能依据两个真实实现提炼公共能力。任何缺失能力都必须标记 `unsupported`；权限模式或工具白名单不得冒充 sandbox。

## 实现前必须固定的契约

- 实现时使用本地 Codex CLI 的 App Server schema generation 能力生成 TypeScript 契约，不手写可漂移的 Thread、Turn、Item、事件和 Review Schema。
- 初始化、工具调用、等待、中断、继续和事件游标的本地实际行为。
- 权限、sandbox、审批和凭据的宿主边界。
- Codex App 与 App Server 之间是否存在可用的 Thread 深链、暂停、恢复和交还能力。
- 一条真实 Codex Smoke，以及同一 Agent Runner 契约在 Codex Adapter 和 Fake 上的独立检查。

当前只接受了首版 Adapter、生成契约和小 Interface 的方向；没有将生成产物写入仓库，也没有本地 Smoke，因此任何具体字段、本地兼容性、暂停恢复或 Codex App 交接声明均为 `Not verified`。
