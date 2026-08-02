# Architecture

> Decision status: Accepted for the current repository shape  
> Implementation evidence: Observed documentation structure; application runtime does not exist

这是当前目录的物理地图，不是未来应用架构的实现声明。

## 当前结构

```text
AGENTS.md                    Agent 导航、范围和工作规则
README.md                    人类入口与当前阶段
ARCHITECTURE.md              当前物理结构和稳定文档边界
docs/
  PLANS.md                   ExecPlan 编写与维护契约
  design-docs/               产品和架构决定
  product-specs/             用户可观察行为与验收
  references/                外部契约和采用边界
  research/                  带日期的调研输入
  exec-plans/                复杂任务的活计划和完成记录
    active/
      symphoneer-v1.md  已确认的 V1 开发与验收计划
```

当前没有应用代码、包管理器、数据库、测试、CI、部署配置或生成流水线，因此也没有可以记录的代码模块、依赖方向或运行时 Codemap。

## 稳定边界

- `AGENTS.md` 负责导航，不复制叶子文档内容。
- `design-docs/` 是确认后设计决定的事实源；`research/` 和 `references/` 只提供输入与外部事实。
- `product-specs/` 用可观察行为定义验收，不代替实现证据。
- `exec-plans/` 保存执行过程，不升级为产品规范。
- 不存在来源和生成命令的材料不进入 `generated/`；当前不保留该目录。

## 目标系统设计

计划中的产品边界见 [`docs/design-docs/product-boundary.md`](docs/design-docs/product-boundary.md)，已确认的对象与职责见 [`docs/design-docs/system-boundaries.md`](docs/design-docs/system-boundaries.md)，实施顺序见 [`docs/exec-plans/active/symphoneer-v1.md`](docs/exec-plans/active/symphoneer-v1.md)。这些文件描述已接受的设计和未执行的计划，不代表已经存在相应模块或真实集成。

代码出现后，本文件应改为真实 Codemap：列出稳定模块、关键入口、允许的依赖方向、跨系统边界和横切关注点，并删除已经失效的 docs-only 描述。
