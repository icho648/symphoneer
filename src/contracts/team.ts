import { z } from "zod";

import { CONTRACT_SCHEMA_VERSION, JsonValueSchema, NonEmptyString, Timestamp } from "./shared.ts";

export const TeamRunStatusSchema = z.enum([
  "planning",
  "awaiting_plan_approval",
  "implementing",
  "reviewing",
  "awaiting_human_input",
  "verifying",
  "awaiting_human_decision",
  "completed",
  "stopped",
  "failed",
]);

export type TeamRunStatus = z.infer<typeof TeamRunStatusSchema>;

export const TeamProviderSchema = z.enum(["fake", "codex-app-server"]);
export type TeamProvider = z.infer<typeof TeamProviderSchema>;

export const TeamRoleSchema = z.enum(["planner", "implementer", "reviewer"]);
export type TeamRole = z.infer<typeof TeamRoleSchema>;

export const AgentAccessSchema = z.enum(["read_only", "exclusive_write"]);
export const AgentRunStatusSchema = z.enum([
  "queued",
  "running",
  "waiting",
  "completed",
  "failed",
  "interrupted",
]);

export const ProviderSessionSchema = z.object({
  provider: TeamProviderSchema,
  threadId: NonEmptyString,
  lastTurnId: NonEmptyString,
});

export type ProviderSession = z.infer<typeof ProviderSessionSchema>;

export const AgentRunSnapshotSchema = z
  .object({
    schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
    id: NonEmptyString,
    teamRunId: NonEmptyString,
    role: TeamRoleSchema,
    access: AgentAccessSchema,
    status: AgentRunStatusSchema,
    providerSession: ProviderSessionSchema.nullable(),
    inputVersion: NonEmptyString,
    reviewRound: z.int().nonnegative(),
    startedAt: Timestamp,
    updatedAt: Timestamp,
    finishedAt: Timestamp.nullable(),
  })
  .superRefine((agent, context) => {
    const terminal =
      agent.status === "completed" || agent.status === "failed" || agent.status === "interrupted";
    if (terminal !== (agent.finishedAt !== null)) {
      context.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "completed or failed AgentRuns require finishedAt",
      });
    }
    if (Date.parse(agent.updatedAt) < Date.parse(agent.startedAt)) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "AgentRun updatedAt cannot precede startedAt",
      });
    }
  });

export type AgentRunSnapshot = z.infer<typeof AgentRunSnapshotSchema>;

export const TeamHumanInputSchema = z.object({
  kind: z.enum(["plan_approval", "review_input", "final_decision"]),
  prompt: NonEmptyString,
  options: z.array(NonEmptyString).min(1),
});

export type TeamHumanInput = z.infer<typeof TeamHumanInputSchema>;

export const TeamRunSnapshotSchema = z.object({
  schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  id: NonEmptyString,
  attemptId: NonEmptyString,
  /** Display / legacy alias for the bound orchestration definition id. */
  workflow: NonEmptyString,
  definitionId: NonEmptyString,
  definitionVersion: z.number().int().positive(),
  definitionHash: z.string().regex(/^[a-f0-9]{64}$/),
  provider: TeamProviderSchema,
  status: TeamRunStatusSchema,
  currentNode: NonEmptyString,
  reviewRound: z.int().nonnegative(),
  reviewDecision: z.enum(["approve", "request_changes", "uncertain"]).nullable(),
  revision: z.int().positive(),
  pendingHumanInput: TeamHumanInputSchema.nullable(),
  verificationStatus: z.enum(["passed", "failed"]).nullable(),
  finalDecision: z.enum(["accept", "stop"]).nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});

export type TeamRunSnapshot = z.infer<typeof TeamRunSnapshotSchema>;

export const TeamVerificationOutcomeSchema = z.object({
  status: z.enum(["passed", "failed"]),
  checkId: NonEmptyString,
  argv: z.array(NonEmptyString).min(1),
  cwd: NonEmptyString,
  gitHead: z.string().regex(/^[a-f0-9]{40}$/),
  worktreeFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  tool: z.object({ name: NonEmptyString, version: NonEmptyString }),
  inputFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  startedAt: Timestamp,
  finishedAt: Timestamp,
  exitCode: z.int(),
  artifact: z.string(),
});

export type TeamVerificationOutcome = z.infer<typeof TeamVerificationOutcomeSchema>;

export const TeamProcessEventTypeSchema = z.enum([
  "session_started",
  "progress_summary",
  "assistant_message",
  "tool_call",
  "command_started",
  "command_completed",
  "file_change_summary",
  "intervention_requested",
  "intervention_resolved",
  "session_completed",
  "session_failed",
  "session_interrupted",
]);

export type TeamProcessEventType = z.infer<typeof TeamProcessEventTypeSchema>;

export const TeamProcessEventSchema = z.object({
  schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  id: NonEmptyString,
  teamRunId: NonEmptyString,
  agentRunId: NonEmptyString,
  role: TeamRoleSchema,
  type: TeamProcessEventTypeSchema,
  occurredAt: Timestamp,
  message: NonEmptyString,
  details: z.record(z.string(), JsonValueSchema).optional(),
});

export type TeamProcessEvent = z.infer<typeof TeamProcessEventSchema>;

export const FakeTeamScenarioSchema = z.object({
  reviewDecisions: z
    .array(z.enum(["approve", "request_changes", "uncertain"]))
    .default(["approve"]),
  verification: z.enum(["passed", "failed"]).default("passed"),
});

export type FakeTeamScenario = z.infer<typeof FakeTeamScenarioSchema>;

// The current Team-shaped flow is exposed as a generic workflow projection so another graph
// does not need to become a new Runtime top-level concept.
export const WorkflowRunSnapshotSchema = TeamRunSnapshotSchema;
export type WorkflowRunSnapshot = TeamRunSnapshot;
export type WorkflowRunStatus = TeamRunStatus;
export type WorkflowProvider = TeamProvider;
export type WorkflowHumanInput = TeamHumanInput;
export const WorkflowProcessEventSchema = TeamProcessEventSchema;
export type WorkflowProcessEvent = TeamProcessEvent;
export type WorkflowProcessEventType = TeamProcessEventType;
export const WorkflowVerificationOutcomeSchema = TeamVerificationOutcomeSchema;
export type WorkflowVerificationOutcome = TeamVerificationOutcome;
export const FakeWorkflowScenarioSchema = FakeTeamScenarioSchema;
export type FakeWorkflowScenario = FakeTeamScenario;
