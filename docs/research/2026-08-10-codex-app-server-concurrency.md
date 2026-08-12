# Codex App Server：同一 Thread 的并发与写入顺序

核验日期：2026-08-10

官方源码快照：[`c8e6e85`](https://github.com/openai/codex/tree/c8e6e8555c42cf9eae0bd3c5f0519b64fce6cbce)

范围：只核对同一 Codex thread 上的 `turn/start`、`turn/steer`、active turn、多客户端写入、排队与冲突行为。未运行本地并发 Smoke。

## 简短结论

- **Observed（公开契约）：** 空闲 thread 用 `turn/start` 开始新 Turn；已有 in-flight Turn 时用 `turn/steer` 追加输入。`turn/steer.expectedTurnId` 必须等于当前 active Turn，否则失败；它不创建新 Turn，也不发送新的 `turn/started`。[Codex App Server 文档：Lifecycle 与 Steer](https://learn.chatgpt.com/docs/app-server.md#lifecycle-overview)
- **Observed（源码）：** 在**同一个 App Server 进程内**，`turn/start`、`turn/steer`、`turn/interrupt` 都以 `threadId` 作为独占序列化键。来自不同连接、但指向同一 loaded thread 的这些请求进入同一个 FIFO；不同 thread 的队列可以并发执行。[协议声明](https://github.com/openai/codex/blob/c8e6e8555c42cf9eae0bd3c5f0519b64fce6cbce/codex-rs/app-server-protocol/src/protocol/common.rs#L863-L878), [`RequestSerializationQueues::enqueue/drain`](https://github.com/openai/codex/blob/c8e6e8555c42cf9eae0bd3c5f0519b64fce6cbce/codex-rs/app-server/src/request_serialization.rs#L148-L235), [FIFO/不同键并发测试](https://github.com/openai/codex/blob/c8e6e8555c42cf9eae0bd3c5f0519b64fce6cbce/codex-rs/app-server/src/request_serialization.rs#L265-L340)
- **Observed（源码）：** 每个 Session 只有一个 `active_turn: Mutex<Option<ActiveTurn>>`。`turn/steer` 在这把锁内检查 active Turn、校验 `expectedTurnId`，再把输入追加到该 Turn 的 pending-input 队列，因此不会产生同一 thread 的第二个并行 active Turn。[`Session.active_turn`](https://github.com/openai/codex/blob/c8e6e8555c42cf9eae0bd3c5f0519b64fce6cbce/codex-rs/core/src/session/session.rs#L40-L63), [`Session::steer_input`](https://github.com/openai/codex/blob/c8e6e8555c42cf9eae0bd3c5f0519b64fce6cbce/codex-rs/core/src/session/mod.rs#L4031-L4107)
- **Observed（源码细节，不应代替公开用法）：** 若普通 Turn 活跃时仍调用 `turn/start`，app-server 先返回新的 submission id；Core 随后串行处理该提交，并把用户输入 admission 为 `Steered` 到现有 active Turn，而不是启动第二个 Turn。若 active Turn 是 Review 或 Compact，则 admission 失败并发出错误事件。因此调用方不能把并发 `turn/start` 的成功响应当作“已创建独立 Turn”的确认，应遵循文档改用 `turn/steer`。[`turn_start_inner`](https://github.com/openai/codex/blob/c8e6e8555c42cf9eae0bd3c5f0519b64fce6cbce/codex-rs/app-server/src/request_processors/turn_processor.rs#L474-L607), [`user_input_or_turn_inner`](https://github.com/openai/codex/blob/c8e6e8555c42cf9eae0bd3c5f0519b64fce6cbce/codex-rs/core/src/session/handlers.rs#L189-L281)
- **Observed：** 多个已初始化连接可以订阅同一 loaded thread；`thread/resume` 会把当前连接加入订阅集合，Turn/Item 事件发送给当时所有订阅连接。源码没有 thread 的单客户端写所有权锁；写冲突由共享的 thread FIFO 和 Turn ID 前置条件处理。[连接订阅集合](https://github.com/openai/codex/blob/c8e6e8555c42cf9eae0bd3c5f0519b64fce6cbce/codex-rs/app-server/src/thread_state.rs#L302-L388), [running thread resume](https://github.com/openai/codex/blob/c8e6e8555c42cf9eae0bd3c5f0519b64fce6cbce/codex-rs/app-server/src/request_processors/thread_lifecycle.rs#L637-L662), [事件 fan-out](https://github.com/openai/codex/blob/c8e6e8555c42cf9eae0bd3c5f0519b64fce6cbce/codex-rs/app-server/src/request_processors/thread_lifecycle.rs#L304-L345)
- **Observed（进程边界）：** 上述队列、loaded thread、订阅集合与 `active_turn` 都是进程内状态。两个分别启动的 App Server 进程不会共享这把队列或 `active_turn`。官方仍开放的 [#34767](https://github.com/openai/codex/issues/34767) 记录了 `0.145.0` 中远程客户端与本地客户端在同一持久化 thread 上产生两个并行 Turn、并发执行工具的事故；截至本次核验没有修复 PR 证据。因此不能把单进程 FIFO 外推为跨进程或跨 transport 的安全保证。

## Active Turn 与冲突

- **Active 状态：** `thread/status/changed` 只给出 `active` 及 `waitingOnApproval` / `waitingOnUserInput` flags，不携带 active Turn ID。客户端应保存 `turn/start` 响应或 `turn/started` 通知中的 ID，再用它作为 `turn/steer.expectedTurnId`。[状态类型](https://github.com/openai/codex/blob/c8e6e8555c42cf9eae0bd3c5f0519b64fce6cbce/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L1447-L1468), [Turn 事件](https://learn.chatgpt.com/docs/app-server.md#turn-events)
- **Steer 冲突：** 无 active Turn、`expectedTurnId` 不匹配、空输入，或 active Turn 为 Review/Compact 时，`turn/steer` 返回 invalid request；成功时返回实际 active Turn ID。[参数契约](https://github.com/openai/codex/blob/c8e6e8555c42cf9eae0bd3c5f0519b64fce6cbce/codex-rs/app-server-protocol/src/protocol/v2/turn.rs#L170-L204), [`turn_steer_inner`](https://github.com/openai/codex/blob/c8e6e8555c42cf9eae0bd3c5f0519b64fce6cbce/codex-rs/app-server/src/request_processors/turn_processor.rs#L910-L1017)
- **Interrupt 冲突：** `turn/interrupt` 同样验证请求中的 Turn ID；ID 不匹配或没有 active Turn 时失败。[`turn_interrupt_inner`](https://github.com/openai/codex/blob/c8e6e8555c42cf9eae0bd3c5f0519b64fce6cbce/codex-rs/app-server/src/request_processors/turn_processor.rs#L1409-L1448)
- **顺序边界：** 同一 thread 的请求在进入序列化队列后按 FIFO 执行；官方源码没有给不同客户端的墙钟发送时间提供额外全序或公平性保证。业务层如需确定“谁有权继续/中断”，仍须自行设置单写者或租约策略。

## 队列与背压

- **WebSocket ingress：** 使用有界队列；队列满时请求返回 JSON-RPC `-32001` / `Server overloaded; retry later.`，官方建议指数退避并加入 jitter。[官方文档](https://learn.chatgpt.com/docs/app-server.md#websocket), [`enqueue_incoming_message`](https://github.com/openai/codex/blob/c8e6e8555c42cf9eae0bd3c5f0519b64fce6cbce/codex-rs/app-server-transport/src/transport/mod.rs#L219-L257)
- **每个 Session 的 Core submission queue：** 容量为 512，发送端使用异步 `send().await`，满时施加背压；`submission_loop` 单个读取并处理提交。[容量与创建](https://github.com/openai/codex/blob/c8e6e8555c42cf9eae0bd3c5f0519b64fce6cbce/codex-rs/core/src/session/mod.rs#L488-L560), [提交发送](https://github.com/openai/codex/blob/c8e6e8555c42cf9eae0bd3c5f0519b64fce6cbce/codex-rs/core/src/session/mod.rs#L836-L889), [`submission_loop`](https://github.com/openai/codex/blob/c8e6e8555c42cf9eae0bd3c5f0519b64fce6cbce/codex-rs/core/src/session/handlers.rs#L706-L770)
- **Thread request serialization queue：** 当前实现是进程内 `HashMap<key, VecDeque<request>>`，源码未设置每个 thread 的独立长度上限；外层 transport ingress 与 Core submission queue 才提供显式容量/背压。

## 对 Symphoneer 的约束

- **Inference：** 一个 Attempt 若绑定一个 Codex thread，应由 Runtime 作为该 thread 的唯一写者；Web 只向 Runtime 发意图，避免多个浏览器连接直接争用 `turn/start` / `turn/steer`。
- **Inference：** Attempt 处于运行中时，补充输入只能携带已观测的 active Turn ID 调用 `turn/steer`；新执行应等待 terminal `turn/completed` 后再调用 `turn/start`。
- **Inference：** `-32001` 是可重试的 transport overload；`expectedTurnId` mismatch、无 active Turn 或 non-steerable Turn 是状态冲突，应刷新 thread/Turn 状态后由业务层决定，而不是盲重试。
- **Inference：** 若 Codex Desktop 通过自己的 App Server 进程恢复同一持久化 thread，它不是 Runtime 当前 stdio App Server 的第二个订阅客户端。除非未来改为共享同一个长生命周期 App Server，否则“在 Codex 中继续”应视为写所有权交接；仅保持 Runtime 子进程不断开，不能获得跨进程排队，反而可能形成两个写者。

## 证据状态

- **Observed：** 以上协议与实现结论来自 2026-08-10 的官方文档和固定源码提交。
- **Not verified：** 本次按要求未启动 app-server，也未进行双 WebSocket 客户端并发 Smoke；WebSocket transport 本身仍被官方标为 experimental/unsupported。
