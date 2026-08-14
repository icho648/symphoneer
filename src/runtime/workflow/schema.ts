import { z } from "zod";

const labels = z.array(z.string().trim().min(1)).default([]);
const states = z.array(z.string().trim().min(1)).min(1);
const positiveInteger = z.int().positive();
const hook = z.string().trim().min(1).optional();

export const RawWorkflowConfigSchema = z
  .object({
    tracker: z.object({
      kind: z.string().trim().min(1),
      provider: z.record(z.string(), z.unknown()).default({}),
      required_labels: labels,
      active_states: states,
      terminal_states: states,
    }),
    polling: z
      .object({
        interval_ms: positiveInteger.default(30_000),
      })
      .default({ interval_ms: 30_000 }),
    workspace: z
      .object({
        root: z.string().trim().min(1).optional(),
      })
      .default({}),
    hooks: z
      .object({
        after_create: hook,
        before_run: hook,
        after_run: hook,
        before_remove: hook,
        timeout_ms: positiveInteger.default(60_000),
      })
      .default({ timeout_ms: 60_000 }),
    agent: z
      .object({
        executor: z.enum(["codex-app-server", "claude-code"]).default("codex-app-server"),
        max_concurrent_agents: positiveInteger.default(10),
        max_turns: positiveInteger.default(20),
        max_retry_backoff_ms: positiveInteger.default(300_000),
        max_concurrent_agents_by_state: z.record(z.string(), z.unknown()).default({}),
      })
      .default({
        executor: "codex-app-server",
        max_concurrent_agents: 10,
        max_turns: 20,
        max_retry_backoff_ms: 300_000,
        max_concurrent_agents_by_state: {},
      }),
    claude: z
      .object({
        command: z.string().trim().min(1).default("claude"),
        argv: z.array(z.string().min(1)).default([]),
        model: z.string().trim().min(1).optional(),
        permission_mode: z
          .enum(["acceptEdits", "auto", "bypassPermissions", "manual", "dontAsk", "plan"])
          .optional(),
        turn_timeout_ms: positiveInteger.default(3_600_000),
        stall_timeout_ms: z.int().nonnegative().default(300_000),
      })
      .default({
        command: "claude",
        argv: [],
        turn_timeout_ms: 3_600_000,
        stall_timeout_ms: 300_000,
      }),
    codex: z
      .object({
        command: z.string().trim().min(1).default("codex app-server"),
        model: z.string().trim().min(1).optional(),
        approval_policy: z.unknown().optional(),
        thread_sandbox: z.unknown().optional(),
        turn_sandbox_policy: z.unknown().optional(),
        turn_timeout_ms: positiveInteger.default(3_600_000),
        read_timeout_ms: positiveInteger.default(5_000),
        stall_timeout_ms: z.int().default(300_000),
      })
      .default({
        command: "codex app-server",
        turn_timeout_ms: 3_600_000,
        read_timeout_ms: 5_000,
        stall_timeout_ms: 300_000,
      }),
    symphoneer: z
      .object({
        eligibility: z
          .object({
            required_labels: labels,
            excluded_labels: labels,
          })
          .default({ required_labels: [], excluded_labels: [] }),
        verification: z
          .array(
            z.object({
              id: z.string().trim().min(1),
              argv: z.array(z.string().min(1)).min(1),
              cwd: z.string().trim().min(1).default("."),
              timeout_ms: positiveInteger,
            }),
          )
          .default([]),
      })
      .default({ eligibility: { required_labels: [], excluded_labels: [] }, verification: [] }),
  })
  .passthrough()
  .superRefine((config, context) => {
    if (config.agent.executor === "claude-code" && !config.claude.permission_mode) {
      context.addIssue({
        code: "custom",
        path: ["claude", "permission_mode"],
        message: "claude.permission_mode is required for the claude-code Executor",
      });
    }
  });
