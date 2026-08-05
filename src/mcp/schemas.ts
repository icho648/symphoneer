import { z } from "zod";

export const NonEmpty = z.string().min(1);
export const IdempotencyKey = NonEmpty.describe("Required idempotency key for Runtime commands");
export const ExpectedSequence = z
  .number()
  .int()
  .nonnegative()
  .optional()
  .describe("Optional Runtime event sequence precondition");
export const ExpectedUpdatedAt = z
  .string()
  .min(1)
  .optional()
  .describe("Optional Attempt updatedAt precondition");
