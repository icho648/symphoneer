# Core Beliefs

> Decision status: Accepted  
> Implementation evidence: Not verified

## 已确认原则

1. **Task-first**：持久身份是 Tracker Task，Run / Attempt 是可重试的执行尝试。
2. **Human authority**：自动化扩大执行能力，不替代资格、接管、验收和最终 Merge 判断。
3. **Evidence-linked**：完成声明必须能追溯到由独立执行者运行的项目检查和不可变证据。
4. **Provider-aware**：保留 GitHub、Symphony 和 Codex 的原生身份与能力，但不为不存在的第二实现预建通用抽象。
5. **Manual-first**：先让人能观察、判定和恢复一条交付闭环，再自动化重复、稳定、可判定的步骤。
6. **Progressive disclosure**：Agent 先获得地图，再按任务进入必要的契约、源码和证据。
7. **Project-local Harness**：Harness 首先是本仓库的文档、项目检查、证据记录和后续定时巡检，不是 Workbench 的产品功能。

## 落地边界

- 本项目不提前提取 Harness Skill；只有在至少两个项目中出现相同、稳定、可复用的需求后再评估。
- 静态文档、Agent 自述、Mock、构建成功或单一评分都不能证明真实运行或业务验收。
- 这些原则已被接受，但尚未由代码、检查、CI 或 Smoke 证明，因此实施证据保持 `Not verified`。

对象权威见 [`system-boundaries.md`](system-boundaries.md)，用户可观察闭环见 [`../product-specs/manual-delivery-flow.md`](../product-specs/manual-delivery-flow.md)，实施阶段见 [`../exec-plans/active/symphony-workbench-v1.md`](../exec-plans/active/symphony-workbench-v1.md)。
