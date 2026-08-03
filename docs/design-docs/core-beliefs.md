# Core Beliefs

> Decision status: Accepted  
> Implementation evidence: Partial — Issue #13 deterministic contracts/core checks; real adapters and Runtime remain Not verified

1. **Task-first**：持久身份是 Tracker Task；Attempt 是一次可重试的执行尝试；Thread 是运行上下文，不是业务任务。
2. **Human authority**：自动化扩大执行能力，不替代资格、接管、验收、Merge 和 Close 判断。
3. **Evidence-linked**：完成声明必须能追溯到独立运行的项目检查、精确版本和不可变 artifact。
4. **Provider-aware**：保留 GitHub、Symphony 和 Codex 的原生身份；只在真实边界稳定后提取通用抽象。
5. **Manual-first**：先形成可观察、可判定、可恢复的人工基线，再自动化重复且稳定的步骤。
6. **Progressive disclosure**：Agent 先获得项目地图，再按当前 Task 进入必要的契约、源码和证据。
7. **Deep seams**：核心 Module 只依赖小而稳定的 Interface；先实现一个真实 Adapter 和一个 Fake，第二个真实实现出现后再提炼共同能力。
8. **Operationally separate**：业务事件、运行日志、验证 artifact 和可选 Trace 各自承担一种证据责任，不能相互冒充。
9. **Storage ownership follows lifecycle**：仓库只拥有需要协作和版本化的项目契约；与项目关联但由 Symphoneer 创建、轮转或回收的数据归安装软件管理，并使用操作系统的数据、日志、缓存和凭据位置。

## 工程默认值

- `symphony-core` 不依赖 Next.js、GitHub SDK 或 Codex 进程实现；Runtime 负责装配 Tracker 与 Agent Runner Adapter，Web 只依赖共享契约。
- 手写实现文件超过约 120 行时触发职责审阅，不作为机械硬限制；生成 Schema、紧密内聚的深 Module 和必要 fixture 可以例外。
- 先按稳定 Module 建目录，再在 Module 内按业务行为或生命周期聚类；行为目录的 `index.ts` 可以作为主入口并承载顶层编排，Module 根 `index.ts` 只暴露稳定 Interface。不要为了文件类型制造 `utils/`、`helpers/` 等浅层桶。
- 测试集中放在根 `tests/`，优先覆盖状态转换、资格判定、backoff、幂等、解析和 reducer；UI 少写组件级单元测试，以交互、可访问性和少量主流程为准。
- 不为未来 Provider、Electron、数据库、队列或多 Agent 创建占位包、空 Interface 或配置。

Issue #13 已用根 `tests/` 和 `pnpm check` 覆盖共享契约、Workflow、资格判定、Attempt 序号与并发所有权、retry、reconciliation、本地目录 Workspace 生命周期与 Fake Runner；这 24 条测试只为对应原则提供本地确定性证据。真实 Adapter、Git worktree 隔离、Runtime、CI 和 Smoke 仍未证明。对象权威见 [`system-boundaries.md`](system-boundaries.md)，用户流程见 [`../product-specs/manual-delivery-flow.md`](../product-specs/manual-delivery-flow.md)，具体实施状态见 active ExecPlan。
