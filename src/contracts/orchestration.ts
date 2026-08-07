import { z } from "zod";

import { NonEmptyString } from "./shared.ts";

export const OrchestrationNodeKindSchema = z.enum(["agent", "human_gate", "verification", "route"]);

export type OrchestrationNodeKind = z.infer<typeof OrchestrationNodeKindSchema>;

export const OrchestrationNodeSchema = z.object({
  id: NonEmptyString,
  kind: OrchestrationNodeKindSchema,
  label: NonEmptyString.optional(),
  role: NonEmptyString.optional(),
  gate: NonEmptyString.optional(),
});

export type OrchestrationNode = z.infer<typeof OrchestrationNodeSchema>;

export const OrchestrationEdgeSchema = z.object({
  from: NonEmptyString,
  to: NonEmptyString,
  when: NonEmptyString.optional(),
});

export type OrchestrationEdge = z.infer<typeof OrchestrationEdgeSchema>;

export const OrchestrationDefinitionSchema = z.object({
  id: NonEmptyString,
  version: z.number().int().positive(),
  label: NonEmptyString.optional(),
  nodes: z.array(OrchestrationNodeSchema).min(1),
  edges: z.array(OrchestrationEdgeSchema).min(1),
});

export type OrchestrationDefinition = z.infer<typeof OrchestrationDefinitionSchema>;

export const OrchestrationBindingSchema = z.object({
  definitionId: NonEmptyString,
  definitionVersion: z.number().int().positive(),
  definitionHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export type OrchestrationBinding = z.infer<typeof OrchestrationBindingSchema>;
