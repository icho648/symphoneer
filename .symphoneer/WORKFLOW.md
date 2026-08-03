---
tracker:
  kind: github
  provider:
    repo: icho648/symphoneer-fixture
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
      timeout_ms: 120000
---

Implement {{ issue.identifier }}: {{ issue.title }}.

Keep the change inside the issue scope, run the configured verification, and stop for human review.
