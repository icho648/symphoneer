import { z } from "zod";

import { CONTRACT_SCHEMA_VERSION, NonEmptyString, Timestamp } from "./shared.ts";

export const TaskSummarySchema = z.object({
  schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  id: NonEmptyString,
  identifier: NonEmptyString,
  source: z.object({
    kind: z.literal("github"),
    nativeId: NonEmptyString,
    url: z.url(),
  }),
  title: NonEmptyString,
  state: NonEmptyString,
  labels: z.array(NonEmptyString).transform((labels) => labels.map((label) => label.toLowerCase())),
  dispatchable: z.boolean(),
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
