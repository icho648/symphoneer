# 个人开发者的可信 AI 交付证据体系

> 核验日期：2026-08-14  
> 状态：Research input；不自动形成产品决定、质量结论或实现授权  
> 来源范围：Midscene、Playwright、Cypress、Codecov、Stryker、fast-check、Pact、Lighthouse CI 的官方文档与官方仓库

## 核心判断

“完备测试”不是一个可以由统一覆盖率证明的状态。对个人开发者，更可执行的目标是：把每项交付声明映射到适用的证据义务，在精确 Candidate 上独立运行；只有证据缺失、矛盾、波动或越过受保护边界时才打断人。

- **Proposed：** Agent 的 Computer Use 或 Midscene 自主探索用于发现路径、生成候选用例和模拟 QA，不直接成为放行 Gate。
- **Proposed：** 固定入库的测试场景、显式预期和受控 CI 环境才负责阻断交付；Agent 可以编写它们，但最终结果由独立进程在精确 Candidate 上重跑。
- **Observed：** 录像、截图和 Trace 提高可复核性与排障效率，不证明测试场景覆盖了需求，也不证明断言正确。
- **Observed：** changed-line / patch coverage 能指出新增或修改代码是否被执行；它不能判断执行结果是否正确，亦不能覆盖删除行为、配置变化和所有间接影响。

## 证据能力矩阵

| 手段 | 能证明什么 | 不能证明什么 | Blocking Gate |
|---|---|---|---|
| 单元 / 组件测试 | 给定输入下的局部行为和显式断言成立 | 真实边界、完整用户旅程、未写入断言的需求 | **是**；项目已有入口默认执行 |
| 固定 Playwright / Cypress E2E | 受控环境中的用户路径、页面状态和外部接线按显式断言工作 | 未列出的旅程、不同生产环境、视觉与业务语义的全部正确性 | **是**；只保留少量关键旅程 |
| Playwright Trace / Cypress Replay / 视频 | 实际执行顺序、失败现场和部分 DOM / 网络 / Console 证据 | 需求覆盖率、断言质量、测试是否本应存在 | **否**；作为失败 artifact |
| Screenshot / visual diff | 固定环境、固定区域与已批准 baseline 的像素差异 | 变化是否符合业务意图、动态区域、跨环境一致性 | **条件式**；仅稳定区域和固定环境 |
| Midscene AI 操作 / `aiAssert` | 基于当前截图或 DOM 的语义导航、探索与模型判断 | 可重复的确定性结论；模型存在 false positive / false negative | **否**；不能单独阻断或放行 |
| Midscene `aiQuery` + 普通 JS assertion | AI 负责提取，代码负责确定性比较；比纯 `aiAssert` 更清楚地暴露预期 | 提取本身仍可能错误，不能替代底层 DOM / API 断言 | **条件式**；关键结论应再由确定性信号校验 |
| Patch line / branch coverage | Candidate 的变更代码是否被所收集测试执行 | 断言是否有效、业务场景是否完备、未执行是否真的不可达 | **条件式**；适合证据缺口 Gate，不是质量分 |
| Mutation testing | 测试能否杀死对生产逻辑的人为小改动，发现“执行了但没断言” | 未建模的缺陷、集成环境和需求正确性 | **条件式**；只用于变更或高风险核心逻辑 |
| Property-based testing | 声明的不变量在大量、可重放的生成输入上成立 | 未声明的不变量；抽样不等于穷举证明 | **是**；适合解析、状态机、算法与边界输入 |
| Contract testing | Consumer / Provider 对请求、响应或消息的共享理解兼容 | Provider 的业务副作用、真实基础设施和完整流程 | **是**；仅在真实服务边界存在时启用 |
| 自动可访问性扫描 | axe 能自动检测的 WCAG / 常见可访问性问题不存在 | 所有 WCAG 问题和真实用户可用性 | **是**；只阻断自动可判定规则 |
| 性能预算 | 受控采样下资源大小、次数或性能指标没有越过已校准阈值 | 真实用户所有设备与网络体验；单次结果稳定性 | **条件式**；稳定预算可阻断，波动分数先告警 |

## 录像、Trace 与流水线重跑

### 不需要默认全程录屏

Playwright 官方建议 CI 失败优先使用 Trace Viewer，而不是单独依赖视频或截图。Trace 包含每步 action、locator、源码位置、DOM snapshot、截图、网络、Console 和 timing；官方建议在首次重试记录，并警告每次都记录会带来明显开销。[Playwright Best Practices](https://playwright.dev/docs/best-practices) · [Trace Viewer](https://playwright.dev/docs/next/trace-viewer)

Cypress 在 `cypress run` 失败时自动截图，视频默认关闭；开启后按 spec 录制。官方示例会删除既未失败也未重试的录像，说明录像更适合作为异常 artifact，而不是每次通过都保存的交付证据。[Cypress screenshots and videos](https://docs.cypress.io/app/guides/screenshots-and-videos)

**Proposed 最小策略：**

1. 固定场景和断言写进仓库，在干净、可复现的 CI 环境重跑一次。
2. 首次失败后最多隔离重试一次，用于分类波动，不用于把失败洗成绿色。
3. 保留首次失败和重试的 Trace；只有 Trace 不足以诊断时才保留视频。
4. 首跑失败、重试通过必须标为 `flaky`。Playwright 与 Cypress 都会显式保留该分类，不能与首次通过等价。[Playwright retries](https://playwright.dev/docs/test-retries) · [Cypress retries](https://docs.cypress.io/app/guides/test-retries)

### Screenshot diff 是判定，不是录像

Playwright 的截图断言可以与 golden 比较并设置像素差阈值，适合固定区域的视觉回归；但官方说明渲染受操作系统、浏览器版本、设置、硬件、电源模式和 headless 状态影响，因此 baseline 必须在与 CI 一致的环境生成。[Playwright visual comparisons](https://playwright.dev/docs/test-snapshots)

因此，全页面默认截图 diff 会制造大量维护和误报。只对稳定、业务关键的组件或状态启用；动态时间、动画、随机数据和外部内容应遮罩或排除。

## Midscene 的合适位置

Midscene 可通过 `PlaywrightAiFixture` 和 reporter 接进现有 Playwright 测试，提供 `aiAct`、`aiTap`、`aiQuery`、`aiAssert`、`aiWaitFor`，并生成包含截图的逐步 HTML 报告。[Midscene Playwright integration](https://www.midscenejs.com/integrate-with-playwright) · [Report parsing](https://midscenejs.com/zh/consume-report-file)

它适合三类场景：

1. **探索：** Agent 用自然语言尝试新增或变化页面，寻找遗漏路径。
2. **难定位界面：** Canvas、图表、无稳定 DOM 语义的控件，由视觉模型执行动作。
3. **候选用例生成：** 把成功探索固化成 Playwright 场景，再交给普通断言做 Gate。

它不宜独自决定交付。Midscene 官方明确说明 `aiAssert` 存在模型 false positive / false negative 风险，并建议需要确定性检查时组合 `aiQuery` 与普通 JavaScript assertion。[Midscene API reference](https://www.midscenejs.com/reference/)

Midscene 缓存可复用规划和定位以降低调用成本，但官方也明确：缓存只是加速手段，不保证脚本长期稳定；页面变化会导致缓存失效并回退到模型，查询与断言也不会被缓存。[Midscene caching](https://www.midscenejs.com/caching)

**Proposed 集成边界：** Symphoneer 只收集 Midscene / Playwright 现成的 exit status、report、Trace 和截图，不重新实现测试运行器或录像系统。AI 可以负责动作；关键通过条件尽量落到 DOM、API、结构化数据或稳定截图 diff。CI 还需固定并记录 Candidate revision、测试命令、浏览器与工具版本、viewport、环境和模型配置。Midscene 会向模型发送页面截图，部分查询还可能发送 DOM，含敏感数据的场景必须先明确数据策略。[Midscene FAQ](https://midscenejs.com/zh/faq)

## Changed-line / Patch Coverage

Codecov 的 `patch` 状态只统计 PR 或 commit 中新增、修改行的覆盖情况；它可以作为“本次变更是否被测试触达”的直接信号。[Codecov status checks](https://docs.codecov.com/do/docs/commit-status) · [Coverage percentages](https://docs.codecov.com/docs/coverage-percentages)

客户端 E2E 覆盖率在技术上可收集：Playwright 的 Coverage API 能收集页面使用到的 JavaScript / CSS 并转换为 Istanbul 数据，但仅支持 Chromium，跨导航也存在架构限制；Cypress 官方维护的 `@cypress/code-coverage` 能合并前端、后端、E2E 和单元测试覆盖率。[Playwright Coverage](https://playwright.dev/docs/next/api/class-coverage) · [Cypress code coverage](https://github.com/cypress-io/code-coverage)

覆盖率的可信用法是“找洞”，不是“证明正确”：

- 变更行未覆盖，是当前测试证据缺失的强信号。
- 变更行已覆盖，只表示执行计数非零；没有断言的测试也能得到高覆盖率。
- Line coverage 不能区分一行中的多个条件；需要同时观察 branch coverage。
- 删除代码、配置、Schema、静态资产和间接影响可能没有对应“新增行”。Codecov 也单独展示未改动源码的间接覆盖变化。[Codecov unexpected coverage changes](https://docs.codecov.com/docs/unexpected-coverage-changes)
- 100% Patch coverage 可能迫使项目为不可到达防御分支或生成代码制造无意义测试，因此排除必须由项目 Policy 显式声明，不能由实现 Agent 临时降低门槛。

**Proposed Gate：** 汇总单元、集成和 E2E 的 coverage 后检查 patch line + branch coverage；未覆盖变更默认产生 evidence gap。是否硬阻断由项目风险 Policy 决定，不使用统一的仓库总覆盖率目标。

## 补足“执行过但没证明”的手段

### Mutation testing

Stryker 会修改生产代码并重跑测试；如果测试仍通过，mutant 存活，说明测试可能只执行了代码但没有有效判断结果。这直接补足普通 coverage 的主要盲区。[Stryker mutation testing](https://stryker-mutator.io/docs/)

Mutation 成本高，不宜默认全仓执行。Stryker 支持只处理变更代码的 incremental 模式和指定行范围，但官方也列出了对测试文件和外部文件变化检测不完整等限制。[Stryker incremental](https://stryker-mutator.io/docs/stryker-js/incremental/)

**Proposed：** 只对新增业务分支、权限、状态迁移、金额或数据转换等高风险逻辑运行 mutation；surviving mutant 形成 evidence gap，不追求全仓统一 mutation score。

### Property-based testing

fast-check 通过生成大量输入、重复运行和缩小反例来检验不变量；随机生成器可用 seed 重放。官方也明确说明通常无法穷举所有值，默认只是采样，因此它增强边界覆盖而不是形式化证明。[fast-check introduction](https://fast-check.dev/docs/introduction/what-is-property-based-testing/)

**Proposed：** 对解析器、序列化、调度不变量、状态机、排序和幂等逻辑优先使用；普通 CRUD 页面不为使用而使用。

### Contract testing

Pact 在 Consumer 与 Provider 分开运行时验证请求、响应或消息契约。官方明确区分：契约测试验证双方对消息的共同理解，不验证 Provider 是否产生正确业务副作用，后者仍属于 Provider functional test。[Pact overview](https://docs.pact.io/getting_started/how_pact_works) · [Contract vs functional tests](https://docs.pact.io/consumer/contract_tests_not_functional_tests)

**Proposed：** 只在真实跨服务或外部 API 边界使用；单进程内部模块不引入 Pact。

### Accessibility 与性能

Playwright 可集成 axe 扫描自动可判定的 WCAG 问题，但官方明确自动化无法发现全部问题。可把确定性规则作为 Gate，不能宣称“可访问性已完整验收”。[Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing)

Lighthouse CI 可以重复采样、聚合并对 audit、资源数量、体积或 user timing 设置 `warn` / `error` 阈值；其官方配置也用多次运行缓解自然波动，并默认不把波动较大的性能 audit 全部做硬失败。[Lighthouse CI configuration](https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md)

**Proposed：** 稳定、可重复的体积和资源预算可以阻断；实验室性能分数先观察基线与波动，再决定是否升级为 Gate。

## 最小交付证据包

不需要先建设通用测试平台。每个 Delivery Candidate 最少保留：

1. Candidate Git revision / tree 与 Assurance Policy 版本。
2. 实际执行命令、退出状态、环境与工具版本。
3. 测试结果及 `passed` / `failed` / `flaky` 分类。
4. Patch line / branch coverage 或明确的 `not_available`。
5. 失败 Trace；按需附视频、截图 diff、Midscene report。
6. 每项验收声明对应哪个检查；没有对应关系时写 evidence gap。

这套证据不能证明软件绝对正确，但能避免三类常见假阳性：Agent 自述成功、代码被执行却没有有效断言、重试后把波动隐藏成绿色。
