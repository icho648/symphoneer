# Codex Worktree 命名边界

核验日期：2026-08-11

本快照只核对 Codex App / Codex CLI 对工作目录、Git 分支和用户可见名称的官方行为。
它是命名讨论的证据输入，不是 Symphoneer 的产品决定。

## 已确认的一手事实

### Codex App：managed worktree 创建时没有分支

`Observed`：Worktree 是 ChatGPT 桌面 App 中 Codex 的能力，Codex CLI 不提供这套
managed-worktree 产品流程。App 默认在 `$CODEX_HOME/worktrees` 下创建 worktree，也允许用户
在 **Settings > Worktrees > Worktree root** 修改根目录。每个 managed worktree 初始使用
detached `HEAD`，不会因创建工作区就生成 Git 分支。

来源：[OpenAI Codex Worktrees](https://developers.openai.com/codex/app/worktrees)

`Observed`：当用户决定继续保留 worktree 中的改动时，App 通过 **Create branch here**
显式创建分支。当前官方文档截图中的分支输入框显示 `codex/` 前缀，并提供 **Set prefix**；
正文示例使用 `feature/a`。因此可确认“前缀可见且可设置”，不能把 `codex/` 推断成不可变契约，
也没有证据表明 App 会按 Issue、标题或 thread ID 自动生成后缀。

来源：[Worktrees 页面及 Create branch 截图](https://developers.openai.com/codex/app/worktrees)、
[官方截图原图](https://developers.openai.com/images/codex/app/worktree-light.webp)

`Not verified`：官方文档没有公开 `$CODEX_HOME/worktrees` 下一级目录的命名算法、碰撞规则或
是否包含 repository / thread 标识。Codex Desktop 本身未开源；公开的 Codex 仓库只能核验
CLI 与 app-server，不能用它证明 App 私有的目录名或展示名算法。

来源：[OpenAI 官方仓库维护者答复](https://github.com/openai/codex/discussions/16538#discussioncomment-16220374)

### Codex CLI：工作区就是调用者选择的目录

`Observed`：Codex CLI 把启动目录视为当前 chat 的 project，也可以通过 `--cd` / `-C`
显式选择目录；CLI 不暴露 ChatGPT Projects 视图。官方 Worktrees 页面又明确 managed worktree
只属于桌面 App，因此 CLI 自身不会替用户命名 managed-worktree 目录或分支。若 CLI 在已有
Git worktree 中启动，它使用的仍是调用者选择的当前目录。

来源：[OpenAI Projects and chats](https://learn.chatgpt.com/docs/projects#choose-a-project-or-chat-without-one)、
[Codex CLI reference](https://developers.openai.com/codex/cli/reference)、
[OpenAI Codex Worktrees](https://developers.openai.com/codex/app/worktrees)

### App Server：执行目录和用户可见名称是两个字段

`Observed`：公开 app-server 协议的 `thread/start` 接收独立的 `cwd`；另一个
`thread/name/set` 方法只设置 thread 的 user-facing name，而且名称不要求唯一。这证明
OpenAI 的公开协议没有把“执行工作区路径”当作“用户看到的任务名”。

来源：[Codex app-server README（固定 commit）](https://github.com/openai/codex/blob/41ece455b7fa7166f4fc38522952afdaa2604e18/codex-rs/app-server/README.md#L167-L198)、
[`ThreadStartParams.cwd`（固定 commit）](https://github.com/openai/codex/blob/41ece455b7fa7166f4fc38522952afdaa2604e18/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L52-L79)

`Observed`：官方用户文档建议用简短的结果导向标题重命名 chat；CLI 也提供 `/rename`
修改当前 chat 名称。这里命名的是对话，不是文件夹或 Git branch。

来源：[OpenAI Projects and chats：Organize projects and chats](https://learn.chatgpt.com/docs/projects#organize-projects-and-chats)、
[Codex CLI slash commands：Rename the current chat](https://developers.openai.com/codex/cli/slash-commands#rename-the-current-chat-with-rename)

`Not verified`：公开资料没有说明桌面 App 的本地 project 展示名、managed worktree 展示名
是否由文件夹 basename、repository 名、chat 标题或其他内部 ID 自动生成。

## 可安全引用的边界

- worktree 目录是可替换的执行环境；官方只公开根目录和生命周期，没有公开子目录命名契约。
- managed worktree 初始不占用 branch；需要保留时再显式创建 branch，官方 UI 当前展示
  可配置的 `codex/` 前缀。
- 人类可见的工作标题属于 chat / thread name；执行位置属于 `cwd`，两者不要求同名。
- 因此不能把 `<repo>-<issue>-<hash>`、`codex/<slug>` 或任何 App 私有目录格式称为
  “Codex 官方命名规则”。
