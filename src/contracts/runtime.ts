import { z } from "zod";

import { ExecutionActivitySchema, ExecutionSessionSchema } from "./activity.ts";
import { DomainEventEnvelopeSchema } from "./event.ts";
import { AttemptSnapshotSchema, WorkspaceReferenceSchema } from "./execution.ts";
import { InterventionSchema, ReviewDecisionSchema } from "./human.ts";
import {
  CONTRACT_SCHEMA_VERSION,
  NonEmptyString,
  PROJECTION_SCHEMA_VERSION,
  Timestamp,
} from "./shared.ts";
import { TaskSummarySchema, WorkflowStatusSchema } from "./task.ts";
import {
  AgentRunSnapshotSchema,
  FakeTeamScenarioSchema,
  TeamProcessEventSchema,
  TeamRunSnapshotSchema,
} from "./team.ts";
import { VerificationResultSchema } from "./verification.ts";

export const RuntimeConnectionSchema = z.object({
  schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  status: z.enum(["online", "offline"]),
  runtimeId: NonEmptyString,
  endpoint: z.url(),
  startedAt: Timestamp,
  lastEventSequence: z.int().nonnegative(),
});

export type RuntimeConnection = z.infer<typeof RuntimeConnectionSchema>;

export const RuntimeProcessSchema = z.object({
  status: z.literal("running"),
  pid: z.int().positive(),
  nodeVersion: NonEmptyString,
  startedAt: Timestamp,
  uptimeSeconds: z.number().nonnegative(),
});

export type RuntimeProcess = z.infer<typeof RuntimeProcessSchema>;

export const RuntimeHealthSchema = z.object({
  schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  status: z.literal("ok"),
  runtime: RuntimeConnectionSchema,
  process: RuntimeProcessSchema,
});

export type RuntimeHealth = z.infer<typeof RuntimeHealthSchema>;

export const RuntimeProjectConfigSchema = z.object({
  trackerKind: NonEmptyString,
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  projectRoot: NonEmptyString.optional(),
  gitCommonDir: NonEmptyString.optional(),
  workspaceRoot: NonEmptyString,
  repositorySource: z.enum(["workflow", "selected"]).optional(),
});

export type RuntimeProjectConfig = z.infer<typeof RuntimeProjectConfigSchema>;

export const RuntimeProjectSchema = RuntimeProjectConfigSchema.extend({
  id: NonEmptyString,
});

export type RuntimeProject = z.infer<typeof RuntimeProjectSchema>;

export const RuntimeRepositoryCandidateSchema = z.object({
  trackerKind: z.literal("github"),
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  remote: NonEmptyString,
});

export type RuntimeRepositoryCandidate = z.infer<typeof RuntimeRepositoryCandidateSchema>;

export const RuntimeProjectPathSelectionSchema = z.object({
  path: NonEmptyString.nullable(),
  repositories: z.array(RuntimeRepositoryCandidateSchema),
});

export type RuntimeProjectPathSelection = z.infer<typeof RuntimeProjectPathSelectionSchema>;

export const RuntimeSnapshotSchema = z.object({
  schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  projectionVersion: z.literal(PROJECTION_SCHEMA_VERSION),
  runtime: RuntimeConnectionSchema,
  tasks: z.array(TaskSummarySchema),
  attempts: z.array(AttemptSnapshotSchema),
  verifications: z.array(VerificationResultSchema),
  reviews: z.array(ReviewDecisionSchema),
  interventions: z.array(InterventionSchema),
  teamRuns: z.array(TeamRunSnapshotSchema),
  agentRuns: z.array(AgentRunSnapshotSchema),
  teamEvents: z.array(TeamProcessEventSchema),
});

export type RuntimeSnapshot = z.infer<typeof RuntimeSnapshotSchema>;

export const RuntimeAttemptDetailSchema = z.object({
  schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  attempt: AttemptSnapshotSchema,
  workspace: WorkspaceReferenceSchema.nullable(),
  verifications: z.array(VerificationResultSchema),
  reviews: z.array(ReviewDecisionSchema),
  interventions: z.array(InterventionSchema),
  teamRuns: z.array(TeamRunSnapshotSchema),
  agentRuns: z.array(AgentRunSnapshotSchema),
  teamEvents: z.array(TeamProcessEventSchema),
  activities: z.array(ExecutionActivitySchema).default([]),
  session: ExecutionSessionSchema.nullable().default(null),
});

export type RuntimeAttemptDetail = z.infer<typeof RuntimeAttemptDetailSchema>;

export const RuntimeEventSchema = z.object({
  sequence: z.int().positive(),
  event: DomainEventEnvelopeSchema,
});

export type RuntimeEvent = z.infer<typeof RuntimeEventSchema>;

const RuntimeCommandBaseSchema = z.object({
  idempotencyKey: NonEmptyString,
  projectId: NonEmptyString.optional(),
  expectedEventSequence: z.int().nonnegative().optional(),
});

export const RuntimeStartModeSchema = z.enum(["single-agent", "team"]);
export type RuntimeStartMode = z.infer<typeof RuntimeStartModeSchema>;
export const ExecutorSandboxSchema = z.enum(["danger-full-access", "read-only", "workspace-write"]);
export type ExecutorSandbox = z.infer<typeof ExecutorSandboxSchema>;
export const ExecutorReasoningEffortSchema = NonEmptyString;
export type ExecutorReasoningEffort = z.infer<typeof ExecutorReasoningEffortSchema>;
export const ExecutorModelSchema = z.object({
  id: NonEmptyString,
  model: NonEmptyString,
  displayName: NonEmptyString,
  description: z.string(),
  isDefault: z.boolean(),
  defaultReasoningEffort: ExecutorReasoningEffortSchema,
  supportedReasoningEfforts: z.array(
    z.object({
      reasoningEffort: ExecutorReasoningEffortSchema,
      description: z.string(),
    }),
  ),
});
export type ExecutorModel = z.infer<typeof ExecutorModelSchema>;
/** @deprecated Use ExecutorSandbox. */
export const CodexSandboxSchema = ExecutorSandboxSchema;
/** @deprecated Use ExecutorSandbox. */
export type CodexSandbox = ExecutorSandbox;
/** @deprecated Use ExecutorReasoningEffort. */
export const CodexReasoningEffortSchema = ExecutorReasoningEffortSchema;
/** @deprecated Use ExecutorReasoningEffort. */
export type CodexReasoningEffort = ExecutorReasoningEffort;
/** @deprecated Use ExecutorModel. */
export const CodexModelSchema = ExecutorModelSchema;
/** @deprecated Use ExecutorModel. */
export type CodexModel = ExecutorModel;

export const RuntimeCommandSchema = z.discriminatedUnion("kind", [
  RuntimeCommandBaseSchema.extend({
    kind: z.literal("pause_attempt"),
    attemptId: NonEmptyString,
    expectedAttemptUpdatedAt: Timestamp.optional(),
  }),
  RuntimeCommandBaseSchema.extend({
    kind: z.literal("retry_attempt"),
    attemptId: NonEmptyString,
    expectedAttemptUpdatedAt: Timestamp.optional(),
  }),
  RuntimeCommandBaseSchema.extend({
    kind: z.literal("handoff_attempt"),
    attemptId: NonEmptyString,
    expectedAttemptUpdatedAt: Timestamp.optional(),
  }),
  RuntimeCommandBaseSchema.extend({
    kind: z.literal("send_attempt_input"),
    attemptId: NonEmptyString,
    expectedAttemptUpdatedAt: Timestamp.optional(),
    prompt: NonEmptyString,
    model: NonEmptyString.optional(),
    sandbox: CodexSandboxSchema.optional(),
    effort: CodexReasoningEffortSchema.optional(),
  }),
  RuntimeCommandBaseSchema.extend({
    kind: z.literal("sync_attempt_session"),
    attemptId: NonEmptyString,
    expectedAttemptUpdatedAt: Timestamp.optional(),
  }),
  RuntimeCommandBaseSchema.extend({
    kind: z.literal("return_attempt_control"),
    attemptId: NonEmptyString,
    expectedAttemptUpdatedAt: Timestamp.optional(),
  }),
  RuntimeCommandBaseSchema.extend({
    kind: z.literal("delete_attempt"),
    attemptId: NonEmptyString,
    expectedAttemptUpdatedAt: Timestamp.optional(),
    confirmDiscard: z.literal(true),
  }),
  RuntimeCommandBaseSchema.extend({
    kind: z.literal("respond_intervention"),
    interventionId: NonEmptyString,
    decidedBy: NonEmptyString,
    decision: z.enum(["approved", "rejected", "answered", "canceled"]),
    response: z.string().optional(),
  }),
  RuntimeCommandBaseSchema.extend({
    kind: z.literal("set_task_status"),
    taskId: NonEmptyString,
    workflowStatus: WorkflowStatusSchema,
  }),
  RuntimeCommandBaseSchema.extend({
    kind: z.literal("enable_task_dispatch"),
    taskId: NonEmptyString,
  }),
  RuntimeCommandBaseSchema.extend({
    kind: z.literal("refresh_tracker"),
  }),
  RuntimeCommandBaseSchema.extend({
    kind: z.literal("record_review"),
    attemptId: NonEmptyString,
    expectedAttemptUpdatedAt: Timestamp.optional(),
    decision: z.enum(["merge_close", "continue", "follow_up", "takeover"]),
    decidedBy: NonEmptyString,
    evidenceIds: z.array(NonEmptyString),
    nextAction: NonEmptyString.nullable().optional(),
  }),
  RuntimeCommandBaseSchema.extend({
    kind: z.literal("start_run"),
    mode: RuntimeStartModeSchema,
    task: TaskSummarySchema,
    workspace: WorkspaceReferenceSchema.optional(),
    attemptId: NonEmptyString.optional(),
    teamRunId: NonEmptyString.optional(),
    scenario: FakeTeamScenarioSchema.optional(),
    model: NonEmptyString.optional(),
    sandbox: CodexSandboxSchema.optional(),
    effort: CodexReasoningEffortSchema.optional(),
  }),
  RuntimeCommandBaseSchema.extend({
    kind: z.literal("approve_plan"),
    teamRunId: NonEmptyString,
    expectedTeamRevision: z.int().positive().optional(),
  }),
  RuntimeCommandBaseSchema.extend({
    kind: z.literal("reject_plan"),
    teamRunId: NonEmptyString,
    expectedTeamRevision: z.int().positive().optional(),
  }),
  RuntimeCommandBaseSchema.extend({
    kind: z.literal("revise_plan"),
    teamRunId: NonEmptyString,
    expectedTeamRevision: z.int().positive().optional(),
  }),
  RuntimeCommandBaseSchema.extend({
    kind: z.literal("stop_team_session"),
    teamRunId: NonEmptyString,
    expectedTeamRevision: z.int().positive().optional(),
  }),
  RuntimeCommandBaseSchema.extend({
    kind: z.literal("resume_team_session"),
    teamRunId: NonEmptyString,
    expectedTeamRevision: z.int().positive().optional(),
  }),
  RuntimeCommandBaseSchema.extend({
    kind: z.literal("answer_team_input"),
    teamRunId: NonEmptyString,
    expectedTeamRevision: z.int().positive().optional(),
    response: z.enum(["approve", "revise", "reject", "request_changes", "accept", "stop"]),
  }),
  RuntimeCommandBaseSchema.extend({
    kind: z.literal("final_decision"),
    teamRunId: NonEmptyString,
    expectedTeamRevision: z.int().positive().optional(),
    decision: z.enum(["accept", "stop"]),
  }),
  RuntimeCommandBaseSchema.extend({
    kind: z.literal("reset_team_run"),
    teamRunId: NonEmptyString,
    expectedTeamRevision: z.int().positive().optional(),
  }),
]);

export type RuntimeCommand = z.infer<typeof RuntimeCommandSchema>;

export const RuntimeCommandResultSchema = z.object({
  schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  accepted: z.boolean(),
  eventSequence: z.int().nonnegative(),
  message: NonEmptyString,
  snapshot: RuntimeSnapshotSchema,
});

export type RuntimeCommandResult = z.infer<typeof RuntimeCommandResultSchema>;
