# Codex App Server

> External source status: Official protocol README observed 2026-08-02; local generated v2 Schema observed 2026-08-03 from `codex-cli 0.146.0`
> Project adoption: Accepted as the first Agent Runtime  
> Implementation evidence: Deterministic JSONL transcript contract checks; real Codex Turn remains Not verified

## 核验入口

- [Codex App Server protocol README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
- [Codex documentation](https://developers.openai.com/codex/)

## 官方契约观察

- App Server 是用于 Codex 客户端集成的双向 JSON-RPC 协议；默认 stdio 传输是 JSONL。
- 协议以 `Thread / Turn / Item` 表达会话、一次交互和其内部事件，并提供 Thread 创建、继续、分叉、Turn 启动与中断等原语。
- Server 会流式发送生命周期、增量输出、命令、文件变更和审批相关事件；客户端需要处理版本匹配的请求、通知与错误。
- 仓库可生成与当前版本匹配的 TypeScript 类型和 JSON Schema；这些外部类型不应由项目手写猜测。

本次实现另外用本机 `codex app-server generate-ts --experimental` 固定了实际消费的 v2 初始化、Thread start/resume、Turn start/interrupt/completed、审批和 `request_user_input` 形状。生成全集未进入仓库；Adapter 只保存并映射 Symphoneer 所需子集。

## Symphoneer 采用边界

- `Thread` 是 Agent 的持久上下文，包含多个 `Turn`；`Item` 是消息、命令、编辑和工具事件等运行单元。
- `Thread` 使用 Symphony `Workspace` 的路径执行，但不拥有目录、分支、所有权或回收生命周期。
- Symphoneer 将 `threadId` / `turnId` 作为 Attempt 的运行引用；一个 Attempt Worker 拥有一个 App Server 进程，并在顺序 Turn 中复用一个 Thread。
- Scheduler 只依赖 `openWorker`；Worker 暴露 `startTurn`、`readSession`、process identity 和 `close`，Turn 的 `RunHandle` 暴露事件流、`interrupt`、介入响应和 completion。Codex Adapter 内部继续保留原生事件。
- 同一 Task 多 Thread 的并行聚合、子 Agent 的业务状态和独立合并证据不属于当前 V1；需要真实需求和新的 Symphoneer 契约。
- V1 只实现 `CodexAppServerAdapter` 和测试 Fake，不建立 Provider factory、通用事件全集或 capability 注册表。

## 后续可行性，不是采用决定

- [Claude Agent SDK for TypeScript](https://code.claude.com/docs/en/agent-sdk/typescript) 提供流式 `query()` 与可中断的 `Query`；如未来采用，应通过独立 Adapter 接入。
- [OpenCode Server](https://opencode.ai/docs/server/) 提供 HTTP、OpenAPI、SSE 和 Session 接口；如未来采用，应通过 HTTP/SSE Adapter 接入。
- 第二个生产 Adapter 获得明确采用决定后，才能依据两个真实实现提炼公共能力。任何缺失能力都必须标记 `unsupported`；权限模式或工具白名单不得冒充 sandbox。

## 已固定与仍待 Smoke

- 已通过本地 Schema、可控 transcript 和确定性子进程检查固定初始化、Thread 创建/继续、同 Worker 多 Turn、Workspace cwd、PID、Turn 中断/完成、审批和 intervention response 的消费字段。
- Adapter 记录 CLI version、协议版本和 hashed input fingerprint，不保存原始 Provider payload 或未经脱敏的错误正文。
- 权限、sandbox、审批和凭据的宿主边界。
- Codex App 与 App Server 之间是否存在可用的 Thread 深链、暂停、恢复和交还能力。
- 一条真实 Codex Smoke，以及同一 Agent Runner 契约在 Codex Adapter 和 Fake 上的独立检查。

当前 transcript 检查只证明 Adapter 对固定消息形状的处理；没有真实 Codex Turn Smoke，因此本机兼容性、无损暂停恢复和 Codex App 交接仍为 `Not verified`。
