---
tracker:
  kind: github
  provider:
    repo: icho648/symphoneer-fixtures
    token: $GITHUB_TOKEN
  active_states: [open]
  terminal_states: [closed]
agent:
  max_concurrent_agents: 1
  max_turns: 20
  max_retry_backoff_ms: 300000
codex:
  command: codex app-server
  approval_policy: on-request
  turn_timeout_ms: 3600000
  stall_timeout_ms: 300000
symphoneer:
  eligibility:
    required_labels: [symphoneer:ready]
    excluded_labels: [symphoneer:review]
  verification:
    - id: check
      argv: [pnpm, check]
      cwd: .
      timeout_ms: 300000
---

Implement {{ issue.identifier }}: {{ issue.title }}.

Treat the linked Issue and repository instructions as the scope and acceptance source. Run the configured checks. Use GitHub-native labels to move the Issue from `symphoneer:ready` to `symphoneer:review`, and leave a short evidence comment when the acceptance conditions are met. If GitHub writes are unavailable, report the blocker instead of claiming completion. Do not merge or close the Issue.
