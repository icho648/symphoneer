import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import { WorkflowError } from "./error.ts";
import { parseFrontMatter } from "./front-matter.ts";
import { RawWorkflowConfigSchema } from "./schema.ts";
import { resolveWorkspaceRoot } from "./workspace-root.ts";

const normalize = (values: string[]) => values.map((value) => value.trim().toLowerCase());

export async function loadWorkflow(
  options: {
    path?: string;
    cwd?: string;
    env?: Readonly<Record<string, string | undefined>>;
    supportedTrackerKinds?: readonly string[];
  } = {},
) {
  const workflowPath = resolve(options.cwd ?? process.cwd(), options.path ?? "WORKFLOW.md");
  let source: string;
  try {
    source = await readFile(workflowPath, "utf8");
  } catch (error) {
    throw new WorkflowError("missing_workflow_file", `Cannot read ${workflowPath}`, {
      cause: error,
    });
  }

  const definition = parseFrontMatter(source);
  const parsed = RawWorkflowConfigSchema.safeParse(definition.config);
  if (!parsed.success) {
    throw new WorkflowError("workflow_validation_error", z.prettifyError(parsed.error));
  }
  const raw = parsed.data;
  if (!(options.supportedTrackerKinds ?? ["github"]).includes(raw.tracker.kind)) {
    throw new WorkflowError(
      "workflow_validation_error",
      `Unsupported tracker kind: ${raw.tracker.kind}`,
    );
  }
  const perState = Object.fromEntries(
    Object.entries(raw.agent.max_concurrent_agents_by_state)
      .filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === "number" && Number.isInteger(entry[1]) && entry[1] > 0,
      )
      .map(([state, limit]) => [state.trim().toLowerCase(), limit]),
  );

  return {
    path: workflowPath,
    promptTemplate: definition.promptTemplate,
    config: {
      tracker: {
        kind: raw.tracker.kind,
        provider: raw.tracker.provider,
        requiredLabels: normalize(raw.tracker.required_labels),
        activeStates: normalize(raw.tracker.active_states),
        terminalStates: normalize(raw.tracker.terminal_states),
      },
      polling: { intervalMs: raw.polling.interval_ms },
      workspace: {
        root: resolveWorkspaceRoot(raw.workspace.root, workflowPath, options.env ?? process.env),
      },
      hooks: {
        afterCreate: raw.hooks.after_create,
        beforeRun: raw.hooks.before_run,
        afterRun: raw.hooks.after_run,
        beforeRemove: raw.hooks.before_remove,
        timeoutMs: raw.hooks.timeout_ms,
      },
      agent: {
        maxConcurrentAgents: raw.agent.max_concurrent_agents,
        maxTurns: raw.agent.max_turns,
        maxRetryBackoffMs: raw.agent.max_retry_backoff_ms,
        maxConcurrentAgentsByState: perState,
      },
      codex: {
        command: raw.codex.command,
        approvalPolicy: raw.codex.approval_policy,
        threadSandbox: raw.codex.thread_sandbox,
        turnSandboxPolicy: raw.codex.turn_sandbox_policy,
        turnTimeoutMs: raw.codex.turn_timeout_ms,
        readTimeoutMs: raw.codex.read_timeout_ms,
        stallTimeoutMs: raw.codex.stall_timeout_ms,
      },
      symphoneer: {
        eligibility: {
          requiredLabels: normalize(raw.symphoneer.eligibility.required_labels),
          excludedLabels: normalize(raw.symphoneer.eligibility.excluded_labels),
        },
        verification: raw.symphoneer.verification.map((check) => ({
          id: check.id,
          argv: check.argv,
          cwd: check.cwd,
          timeoutMs: check.timeout_ms,
        })),
      },
    },
  };
}

export type Workflow = Awaited<ReturnType<typeof loadWorkflow>>;
