# GitHub Issues

> Decision status: Accepted as the V1 Tracker  
> External source status: Official source locators observed 2026-08-01; selected endpoint behavior not verified  
> Contract evidence: REST `2022-11-28` request and payload mapping covered by deterministic Adapter tests
> Implementation evidence: Fake HTTP only; live Adapter network behavior remains Not verified

## 官方核验入口

- [GitHub REST API endpoints for issues](https://docs.github.com/en/rest/issues/issues?apiVersion=2022-11-28)
- [GitHub REST API endpoints for labels](https://docs.github.com/en/rest/issues/labels?apiVersion=2022-11-28)
- [GitHub REST API endpoints for sub-issues](https://docs.github.com/en/rest/issues/sub-issues?apiVersion=2022-11-28)
- [GitHub REST API endpoints for issue dependencies](https://docs.github.com/en/rest/issues/issue-dependencies?apiVersion=2022-11-28)
- [GitHub REST API endpoints for Projects](https://docs.github.com/en/rest/projects/projects)
- [GitHub REST API endpoints for Project items](https://docs.github.com/en/rest/projects/items?apiVersion=2022-11-28)
- [GitHub REST API endpoints for Project fields](https://docs.github.com/en/rest/projects/fields?apiVersion=2026-03-10)
- [GitHub REST API endpoints for milestones](https://docs.github.com/en/rest/issues/milestones?apiVersion=2022-11-28)
- [Authenticating to the REST API](https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api)

这些官方页面在 2026-08-01 可观察。它们是实现前固定 API 版本、Issue / Pull Request 区分、标签读写、Sub-issue / Dependency、Projects、Project fields、Milestone 和凭据权限的入口，不证明本项目已完成这些契约的选择或 Smoke。

## 已确认角色

- GitHub Issues 保存 V1 Task 的原生身份、意图、状态和协作记录。
- Symphoneer 只保存 Task 引用和执行投影，不建立竞争性的 Task 真相。
- Run、Attempt、Workspace 和验证证据不反向塞入 Issue 作为完整运行日志数据库。
- V1 只调度原生状态为 `open`、包含 `symphoneer:ready`、不包含 `symphoneer:review` 的 Issue。
- 首个真实 E2E 目标是专用私有仓库 `icho648/symphoneer-fixture`；已有创建授权，但只在 Smoke 阶段创建仓库、Issue 和标签。

## 元数据采用边界

- Issue / Sub-issue / Dependency 表达任务和独立交付物；Sub-issue 不是 Thread 的替代日志。
- Labels 用于分类、风险和粗粒度门禁，不为每个 Attempt 或 Thread 建动态标签。
- Projects 用于计划、聚合状态和筛选视图；Attempt、Workspace、Thread 和 Verification 详情属于 Symphoneer。
- Milestone 用于版本或交付目标，不用于表示 Session、Attempt 或 Agent 数量。

以上是 Symphoneer 的采用方向，不证明 GitHub API、写回权限、Project 字段或父子关系已经在本项目中完成 Smoke。

## 已固定与仍待 Smoke

- Adapter 已固定 `open + symphoneer:ready - symphoneer:review` 门禁、原生 database ID、Issue URL、ETag 和 `updated_at` 冲突检查。
- 标签门禁在当前 GitHub API、权限模型和最终一致性下的真实行为。
- 其他原生 Issue 状态与 Symphoneer Task 投影的映射。
- Adapter 的读取、评论、状态更新和交接写回权限。
- PR、Checks、Review 和 Merge 与 Issue 的原生关联方式。
- 限流、权限不足、删除、转移和最终一致性下的失败表达。

标签规则和 fixture 是已接受的项目决定；fake HTTP contract tests 不是 GitHub 网络证据。所有外部行为只有在后续真实仓库 Smoke 后才能升级为 `Verified`。
