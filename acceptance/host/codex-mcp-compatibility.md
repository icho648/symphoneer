# Codex MCP Host 兼容性 Smoke

这是需要人执行的 Host 兼容性与主链路冒烟流程，不属于自动化 `pnpm test`。

## 前置条件

- 在仓库根目录执行 `pnpm up`，确认 Runtime 已启动。
- 检查 `curl http://127.0.0.1:4318/healthz` 返回成功。
- 在 Codex 的 MCP 配置中指向当前仓库：

```toml
[mcp_servers.symphoneer]
command = "pnpm"
args = ["mcp:serve"]
cwd = "/Users/icho/safe-projects/symphoneer"
```

## 固定步骤

1. 重新加载 MCP 配置或启动一个新的 Codex 任务。
2. 请求 Codex 只调用 `runtime_health`，不要执行写操作。
3. 请求 Codex 调用 `runtime_snapshot`。
4. 请求 Codex 调用 `list_events`，参数 `after=0`。
5. 确认 Codex 能展示工具调用结果，且没有把 MCP 协议消息当成普通文本日志。

## 预期结果

- Codex 能发现并连接 `symphoneer` MCP Server。
- `runtime_health` 返回 Runtime 正常状态，结构化结果中的 `ok` 为 `true`。
- `runtime_snapshot` 和 `list_events` 返回合法结构，即使当前没有 Task 或 Attempt 也不能协议失败。
- 未经明确批准不调用 `pause_attempt`、`retry_attempt` 或 `respond_intervention`。

## 证据记录

```text
日期：
Git revision：
Codex 版本：
Runtime 版本/启动命令：
结果：PASS / FAIL / INFRA / NOT_RUN / NOT_VERIFIED
日志、截图或错误：
```

如果要验证写操作，必须使用隔离 Attempt、明确批准、唯一幂等键和可清理数据；不要把生产数据作为手动测试夹具。
