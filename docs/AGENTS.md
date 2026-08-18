# Symphoneer Docs — Agent Map

本文件只负责 `docs/` 的按需路由和事实源归属。根 [`../AGENTS.md`](../AGENTS.md) 的仓库规则继续适用；不要递归读取整个目录。

## 读取路由

| 任务 | 先读 | 再按需读取 |
|---|---|---|
| 产品定位、用户与非目标 | [`core-concepts/product-boundary.md`](core-concepts/product-boundary.md) | `system-boundaries.md` |
| 对象权威、Runtime、存储与控制 | [`core-concepts/system-boundaries.md`](core-concepts/system-boundaries.md) | 对应 reference |
| Executor Prompt、原生指令与 Session | [`core-concepts/executor-context.md`](core-concepts/executor-context.md) | Codex reference 或关联 Issue |
| 用户可观察交付流程 | [`core-concepts/delivery-flow.md`](core-concepts/delivery-flow.md) | `system-boundaries.md` |
| 设计判断原则 | [`decisions/design-principles.md`](decisions/design-principles.md) | 对应核心概念 |
| Web 多语言与主题 | [`decisions/web-i18n-theme.md`](decisions/web-i18n-theme.md) | 当前 Web 源码与测试 |
| 外部契约 | [`references/symphony-spec.md`](references/symphony-spec.md)、[`references/codex-app-server.md`](references/codex-app-server.md)、[`references/github-issues.md`](references/github-issues.md) | 对应核心概念 |
| 调研输入与历史方案 | [`research/AGENTS.md`](research/AGENTS.md) | 对应日期快照 |
| 复杂任务与本地恢复 | [`plans/AGENTS.md`](plans/AGENTS.md) | 对应 active plan |

## 事实源与写入规则

- `core-concepts/` 解释当前稳定的产品心智模型、对象关系和可观察规则；模型变化时直接更新，不保留实现流水账。
- `decisions/` 记录已接受、跨 Issue 稳定的取舍和原因；不是不可变 ADR 档案，也不复制核心概念正文。
- `references/` 保存外部一手契约、核验日期与本项目采用差异；`research/` 保存带日期的分析、比较和历史输入。外部资料和研究都不能证明实现完成，也不能扩大 Issue 授权。
- 研究结论被接受后，提炼进 `core-concepts/` 或移动到 `decisions/`，不在两个位置长期维护同一结论。
- `plans/` 只补充 Issue 未承载的本地恢复与跨 Issue 协调；实时目标、范围、验收、进度和验证仍以 Issue / PR 为准。
- 稳定的项目决定可以从用户偏好或历史记忆中恢复，但写入前必须与当前代码、Issue 或一手契约核对。个人习惯、临时优先级和旧实现状态不进入规范文档。
- 规范性文档分开写 `Decision status` 与 `Implementation evidence`。Task-first、Tracker 事实源、Scheduler 拥有 Attempt、Executor 拥有原生 Session、Workbench 只做投影与控制、人决定 Merge / Close，是当前稳定边界；具体证据仍按能力逐项标记。
- 并发按 Scheduler 的活跃或预留 Attempt 槽位解释，不按 OS 子进程数解释；`ProjectPollingCoordinator` 不是 Host 级 Agent 并发门。Phoenix / Evaluation 只作后置诊断，不进入核心正确性或近期默认范围。
- 新增或删除叶子文档时更新本文件或最近的局部 `AGENTS.md`；只有出现独立路由或生命周期规则时才增加新的局部入口。
