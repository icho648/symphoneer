# Core Beliefs

> Decision status: Accepted  
> Implementation evidence: Not verified

1. **Task-first**：持久身份是 Tracker Task；Attempt 是一次可重试的执行尝试；Thread 是运行上下文，不是业务任务。
2. **Human authority**：自动化扩大执行能力，不替代资格、接管、验收、Merge 和 Close 判断。
3. **Evidence-linked**：完成声明必须能追溯到独立运行的项目检查、精确版本和不可变 artifact。
4. **Provider-aware**：保留 GitHub、Symphony 和 Codex 的原生身份；只在真实边界稳定后提取通用抽象。
5. **Manual-first**：先形成可观察、可判定、可恢复的人工基线，再自动化重复且稳定的步骤。
6. **Progressive disclosure**：Agent 先获得项目地图，再按当前 Task 进入必要的契约、源码和证据。

这些原则指导设计取舍，但尚未由代码、CI 或 Smoke 证明。对象权威见 [`system-boundaries.md`](system-boundaries.md)，用户流程见 [`../product-specs/manual-delivery-flow.md`](../product-specs/manual-delivery-flow.md)。
