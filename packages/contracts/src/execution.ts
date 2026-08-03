import { z } from "zod";

import { CONTRACT_SCHEMA_VERSION, NonEmptyString, Timestamp } from "./shared.ts";

export const WorkspaceReferenceSchema = z
  .object({
    schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
    id: NonEmptyString,
    taskId: NonEmptyString,
    path: NonEmptyString,
    repository: NonEmptyString,
    branch: NonEmptyString,
    host: NonEmptyString,
    state: z.enum(["reserved", "ready", "retained", "released"]),
    ownerAttemptId: NonEmptyString.nullable(),
  })
  .superRefine((workspace, context) => {
    const activelyOwned = workspace.state === "reserved" || workspace.state === "ready";
    if (activelyOwned !== (workspace.ownerAttemptId !== null)) {
      context.addIssue({
        code: "custom",
        path: ["ownerAttemptId"],
        message: "only reserved or ready workspaces have an active Attempt owner",
      });
    }
  });

export type WorkspaceReference = z.infer<typeof WorkspaceReferenceSchema>;

export const AttemptStatusSchema = z.enum([
  "preparing_workspace",
  "building_prompt",
  "launching_agent",
  "initializing_session",
  "streaming_turn",
  "finishing",
  "succeeded",
  "failed",
  "timed_out",
  "stalled",
  "canceled_by_reconciliation",
]);

const terminalAttemptStatuses = new Set([
  "succeeded",
  "failed",
  "timed_out",
  "stalled",
  "canceled_by_reconciliation",
]);

export const AttemptSnapshotSchema = z
  .object({
    schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
    id: NonEmptyString,
    taskId: NonEmptyString,
    sequence: z.int().positive(),
    startReason: z.enum(["dispatch", "retry", "continuation", "reconciliation"]),
    status: AttemptStatusSchema,
    workspaceId: NonEmptyString,
    activeTurn: z
      .object({
        threadId: NonEmptyString,
        turnId: NonEmptyString,
      })
      .nullable()
      .optional(),
    startedAt: Timestamp,
    updatedAt: Timestamp,
    finishedAt: Timestamp.nullable().optional(),
    failure: NonEmptyString.nullable().optional(),
  })
  .superRefine((attempt, context) => {
    const terminal = terminalAttemptStatuses.has(attempt.status);
    if (terminal !== (attempt.finishedAt != null)) {
      context.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "terminal Attempts require finishedAt and active Attempts must not have it",
      });
    }
    if ((attempt.status === "streaming_turn") !== (attempt.activeTurn != null)) {
      context.addIssue({
        code: "custom",
        path: ["activeTurn"],
        message: "streaming_turn and active Turn ownership must exist together",
      });
    }
    if (attempt.status === "succeeded" && attempt.failure != null) {
      context.addIssue({
        code: "custom",
        path: ["failure"],
        message: "successful Attempts cannot have a failure",
      });
    }
    if (Date.parse(attempt.updatedAt) < Date.parse(attempt.startedAt)) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "Attempt updatedAt cannot precede startedAt",
      });
    }
    if (
      attempt.finishedAt != null &&
      Date.parse(attempt.finishedAt) < Date.parse(attempt.updatedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "Attempt finishedAt cannot precede updatedAt",
      });
    }
  });

export type AttemptSnapshot = z.infer<typeof AttemptSnapshotSchema>;
