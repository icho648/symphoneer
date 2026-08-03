import { z } from "zod";

import { CONTRACT_SCHEMA_VERSION, NonEmptyString, Timestamp } from "./shared.ts";

export const VerificationStatusSchema = z.enum([
  "passed",
  "failed",
  "timed_out",
  "not_run",
  "not_verified",
]);

export const VerificationResultSchema = z
  .object({
    schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
    id: NonEmptyString,
    attemptId: NonEmptyString,
    checkId: NonEmptyString,
    status: VerificationStatusSchema,
    argv: z.array(NonEmptyString).min(1),
    cwd: NonEmptyString,
    gitHead: NonEmptyString,
    startedAt: Timestamp,
    finishedAt: Timestamp.nullable(),
    exitCode: z.int().nullable(),
    artifactRef: NonEmptyString.nullable(),
  })
  .superRefine((verification, context) => {
    const ran = verification.status !== "not_run" && verification.status !== "not_verified";
    if (ran !== (verification.finishedAt !== null && verification.artifactRef !== null)) {
      context.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "executed checks require completion time and immutable artifact reference",
      });
    }
    if (verification.status === "passed" && verification.exitCode !== 0) {
      context.addIssue({
        code: "custom",
        path: ["exitCode"],
        message: "passed Verification requires exitCode 0",
      });
    }
    if (!ran && verification.exitCode !== null) {
      context.addIssue({
        code: "custom",
        path: ["exitCode"],
        message: "checks that did not run cannot have an exit code",
      });
    }
  });

export type VerificationResult = z.infer<typeof VerificationResultSchema>;
