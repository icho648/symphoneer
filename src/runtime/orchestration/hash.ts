import { createHash } from "node:crypto";

import {
  type OrchestrationBinding,
  type OrchestrationDefinition,
  OrchestrationDefinitionSchema,
} from "@symphoneer/contracts";

export function hashOrchestrationDefinition(definition: OrchestrationDefinition): string {
  const canonical = JSON.stringify(OrchestrationDefinitionSchema.parse(definition));
  return createHash("sha256").update(canonical).digest("hex");
}

export function bindOrchestrationDefinition(
  definition: OrchestrationDefinition,
): OrchestrationBinding {
  const parsed = OrchestrationDefinitionSchema.parse(definition);
  return {
    definitionId: parsed.id,
    definitionVersion: parsed.version,
    definitionHash: hashOrchestrationDefinition(parsed),
  };
}
