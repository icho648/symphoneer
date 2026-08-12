import { z } from "zod";

import { CONTRACT_SCHEMA_VERSION, NonEmptyString, Timestamp } from "./shared.ts";

export const WorkflowStatusSchema = z.enum([
  "backlog",
  "ready",
  "in_progress",
  "in_review",
  "done",
]);

export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;

export const BlockedTaskSchema = z.object({
  reason: NonEmptyString,
  since: Timestamp,
});

export type BlockedTask = z.infer<typeof BlockedTaskSchema>;

export const TaskSummarySchema = z.object({
  schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  projectId: NonEmptyString.optional(),
  id: NonEmptyString,
  identifier: NonEmptyString,
  source: z.object({
    kind: NonEmptyString,
    nativeId: NonEmptyString,
    url: z.url(),
  }),
  title: NonEmptyString,
  body: z.string().nullable().optional(),
  state: NonEmptyString,
  labels: z.array(NonEmptyString).transform((labels) => labels.map((label) => label.toLowerCase())),
  dispatchable: z.boolean(),
  workflowStatus: WorkflowStatusSchema.default("backlog"),
  blocked: BlockedTaskSchema.nullable().default(null),
  priority: z.int().nullable().optional(),
  createdAt: Timestamp.nullable().optional(),
  updatedAt: Timestamp.nullable().optional(),
});

export type TaskSummary = z.infer<typeof TaskSummarySchema>;

export const EligibilityReasonSchema = z.enum([
  "not_dispatchable",
  "inactive_state",
  "terminal_state",
  "missing_required_label",
  "excluded_label",
  "already_claimed",
  "global_concurrency_exhausted",
  "state_concurrency_exhausted",
  "workspace_owned",
  "workspace_identity_mismatch",
]);

export type EligibilityReason = z.infer<typeof EligibilityReasonSchema>;

export const EligibilityResultSchema = z
  .object({
    schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
    taskId: NonEmptyString,
    eligible: z.boolean(),
    reasons: z.array(EligibilityReasonSchema),
  })
  .superRefine((result, context) => {
    if (result.eligible !== (result.reasons.length === 0)) {
      context.addIssue({
        code: "custom",
        path: ["eligible"],
        message: "eligible must match whether reasons is empty",
      });
    }
  });

export type EligibilityResult = z.infer<typeof EligibilityResultSchema>;
