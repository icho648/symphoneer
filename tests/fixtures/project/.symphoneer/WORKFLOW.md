---
tracker:
  kind: github
  active_states: [open]
  terminal_states: [closed]
agent:
  max_concurrent_agents: 1
symphoneer:
  eligibility:
    required_labels: [symphoneer:ready]
    excluded_labels: [symphoneer:review]
---

Implement {{ issue.identifier }}: {{ issue.title }}.
