import { z } from "zod";

import { CONTRACT_SCHEMA_VERSION, NonEmptyString, Timestamp } from "./shared.ts";

export const ReviewDecisionSchema = z.object({
  schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  id: NonEmptyString,
  attemptId: NonEmptyString,
  decision: z.enum(["merge_close", "continue", "follow_up", "takeover"]),
  decidedBy: NonEmptyString,
  decidedAt: Timestamp,
  evidenceIds: z.array(NonEmptyString),
  nextAction: NonEmptyString.nullable().optional(),
});

export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

const InterventionResolutionSchema = z.object({
  decidedBy: NonEmptyString,
  decidedAt: Timestamp,
  decision: z.enum(["approved", "rejected", "answered", "canceled"]),
  response: z.string().optional(),
});

export const InterventionSchema = z
  .object({
    schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
    id: NonEmptyString,
    attemptId: NonEmptyString,
    requestRef: NonEmptyString,
    kind: z.enum(["approval", "input", "ownership_conflict", "external_state_unknown"]),
    state: z.enum(["pending", "resolved", "canceled"]),
    prompt: NonEmptyString,
    createdAt: Timestamp,
    resolution: InterventionResolutionSchema.nullable().optional(),
  })
  .superRefine((intervention, context) => {
    if ((intervention.state === "resolved") !== (intervention.resolution != null)) {
      context.addIssue({
        code: "custom",
        path: ["resolution"],
        message: "resolved interventions require an explicit human or Host decision",
      });
    }
  });

export type Intervention = z.infer<typeof InterventionSchema>;
