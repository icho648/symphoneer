# Tests — Agent Map

这是自动化测试目录的局部 Agent Interface。`tests/` 只承载可由 Node test runner 执行的测试；需要人执行或判断的流程统一放在仓库根目录的 `acceptance/`。

## 目录结构

```text
tests/
  unit/          单模块、隔离、快速
  contract/      Schema、协议和边界约定
  integration/   本地多模块协作
  e2e/           跨边界完整链路
  fixtures/      测试专用 Fake 和固定数据
```

## 分类规则

- `unit` 不启动进程、HTTP 服务或真实外部系统；验证单个模块的公开行为。
- `contract` 验证版本化 Schema、JSON-RPC/MCP 工具形状、适配器约定和能力边界。
- `integration` 可以使用临时目录、临时 Runtime、HTTP 和 Fake，验证多个本地模块的协作。
- `e2e` 验证从入口到结果的完整本地链路，例如真实进程、STDIO、Runtime 和 Verification 的组合。
- `fixtures` 只提供隔离测试数据和边界替身；Fake 通过测试不能证明真实 Provider、部署或外部服务。

`Smoke` 不是独立目录，而是测试用途或运行集合：少量、快速、只覆盖主链路。自动化 Smoke 放在对应的 `unit`、`contract`、`integration` 或 `e2e` 下，并用文件名或独立命令选出；需要人执行的 Smoke 放在 `acceptance/`。

## 运行与维护

- `pnpm test` 运行所有自动化 Node 测试；`pnpm test:unit`、`pnpm test:contract`、`pnpm test:integration`、`pnpm test:e2e` 运行对应范围。
- `acceptance/` 中的人工流程不由 `pnpm test` 伪装执行。每个流程必须写明前置条件、版本、固定步骤、预期结果、实际证据和 `PASS` / `FAIL` / `INFRA` / `NOT_RUN` / `NOT_VERIFIED` 状态。
- 测试验证公开行为和风险，不绑定内部实现；修改边界、协议、状态转换或用户结果时，更新受影响层级的最小用例。
- 默认 CI 保持确定性、隔离、无凭证、无付费服务和无生产写入；真实 Host、部署、Provider、视觉和人工业务判断进入明确的验收流程。
- 失败先判断代码、环境、并发或测试数据问题；不要通过删除断言、放宽预期或把 `NOT_RUN` 改成 `PASS` 来修复结果。
