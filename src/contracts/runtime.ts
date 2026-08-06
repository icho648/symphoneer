import { z } from "zod";

import { DomainEventEnvelopeSchema } from "./event.ts";
import { AttemptSnapshotSchema, WorkspaceReferenceSchema } from "./execution.ts";
import { InterventionSchema, ReviewDecisionSchema } from "./human.ts";
import {
  CONTRACT_SCHEMA_VERSION,
  NonEmptyString,
  PROJECTION_SCHEMA_VERSION,
  Timestamp,
} from "./shared.ts";
import { TaskSummarySchema } from "./task.ts";
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
});

export type RuntimeAttemptDetail = z.infer<typeof RuntimeAttemptDetailSchema>;

export const RuntimeEventSchema = z.object({
  sequence: z.int().positive(),
  event: DomainEventEnvelopeSchema,
});

export type RuntimeEvent = z.infer<typeof RuntimeEventSchema>;

const RuntimeCommandBaseSchema = z.object({
  idempotencyKey: NonEmptyString,
  expectedEventSequence: z.int().nonnegative().optional(),
});

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
    kind: z.literal("respond_intervention"),
    interventionId: NonEmptyString,
    decidedBy: NonEmptyString,
    decision: z.enum(["approved", "rejected", "answered", "canceled"]),
    response: z.string().optional(),
  }),
  RuntimeCommandBaseSchema.extend({
    kind: z.literal("start_team_run"),
    task: TaskSummarySchema,
    workspace: WorkspaceReferenceSchema.optional(),
    attemptId: NonEmptyString.optional(),
    teamRunId: NonEmptyString.optional(),
    scenario: FakeTeamScenarioSchema.optional(),
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
