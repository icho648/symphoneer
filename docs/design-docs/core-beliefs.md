# Core Beliefs

> Decision status: Accepted  
> Implementation evidence: Partial — deterministic contracts/core checks; real adapters and Runtime remain Not verified

1. **Task-first**：持久身份是 Tracker Task；Attempt 是一次可重试的执行尝试；Thread 是运行上下文，不是业务任务。
2. **Human authority**：自动化扩大执行能力，不替代资格、接管、验收、Merge 和 Close 判断。
3. **Evidence-linked**：完成声明必须能追溯到独立运行的项目检查、精确版本和不可变 artifact。
4. **Provider-aware**：保留 GitHub、Symphony 和 Codex 的原生身份；只在真实边界稳定后提取通用抽象。
5. **Manual-first**：先形成可观察、可判定、可恢复的人工基线，再自动化重复且稳定的步骤。
6. **Progressive disclosure**：Agent 先获得项目地图，再按当前 Task 进入必要的契约、源码和证据。
7. **Deep seams**：核心 Module 只依赖小而稳定的 Interface；先实现一个真实 Adapter 和一个 Fake，第二个真实实现出现后再提炼共同能力。
8. **Operationally separate**：业务事件、运行日志、验证 artifact 和可选 Trace 各自承担一种证据责任，不能相互冒充。
9. **Storage ownership follows lifecycle**：仓库只拥有需要协作和版本化的项目契约；与项目关联但由 Symphoneer 创建、轮转或回收的数据归安装软件管理，并使用操作系统的数据、日志、缓存和凭据位置。

## 工程落点

可执行工程规则只维护在根 [`../../AGENTS.md`](../../AGENTS.md)，当前物理证据见 [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md)，具体实施状态与检查结果见 [`../plans/active/symphoneer-v1.md`](../plans/active/symphoneer-v1.md)。这些入口落实本文件原则，但不反向改写原则。

对象权威见 [`system-boundaries.md`](system-boundaries.md)，用户流程见 [`../product-specs/manual-delivery-flow.md`](../product-specs/manual-delivery-flow.md)。真实 Adapter、Git worktree 隔离、Runtime、CI 和 Smoke 在匹配证据出现前保持 `Not verified`。
