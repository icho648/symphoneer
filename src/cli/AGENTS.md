# CLI — Agent Guidance

本目录是**人用** CLI / TUI 访问面，不是 Runtime 或 MCP 的进程入口。根 [`../../AGENTS.md`](../../AGENTS.md) 与 [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) 继续适用；产品边界见 [`../../docs/core-concepts/product-boundary.md`](../../docs/core-concepts/product-boundary.md)。

## 职责

- 面向开发者的命令行（及后续 TUI）：查询与受控操作 Runtime 投影。
- 与 Web、MCP 同级，复用同一 loopback Runtime；不复制 Scheduler 或业务状态。

## 非职责

- **不是** Runtime HTTP 进程入口 → 使用 [`../runtime/serve.ts`](../runtime/serve.ts)（`pnpm runtime:serve`）。
- **不是** MCP STDIO 进程入口 → 使用 [`../mcp/stdio.ts`](../mcp/stdio.ts)（`pnpm mcp:serve`）。
- 不实现 Commit、Push、PR、Merge、Close 或权限扩大。
- 不直接 import `@symphoneer/runtime`；只经 `@symphoneer/runtime-client` 访问 loopback Runtime。

## 当前内容

| 文件 | 说明 |
|---|---|
| [`runtime.ts`](runtime.ts) | 查询 CLI：`snapshot` / `events` / `attempt`（`pnpm runtime:cli`） |
| [`package.json`](package.json) | 进程脚本边界 |

V1 当前仅有只读查询；受控变更（pause / retry / respond_intervention）若进入 CLI，必须映射现有 Runtime command schema，并携带幂等键与前置条件，不得发明第二套状态机。

## 依赖与检查

```text
src/cli ──> @symphoneer/runtime-client (+ contracts via client)
         ──X──> @symphoneer/runtime
```

`scripts/check-project.mjs` 禁止 `src/cli/**` import `@symphoneer/runtime`。

## 读取路由

| 任务 | 先读 | 再按需 |
|---|---|---|
| 改 CLI 命令或输出 | 本文件、`runtime.ts` | Runtime HTTP 契约（经 runtime-client / contracts） |
| 扩展 TUI | 本文件、product-boundary | Web Task Board 仅作 UX 参考，不共享 UI 代码 |
| Runtime 启动 / 健康 | `../runtime/serve.ts` | 不要改本目录来「顺便」起服务 |
