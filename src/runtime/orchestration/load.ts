import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  type OrchestrationBinding,
  type OrchestrationDefinition,
  OrchestrationDefinitionSchema,
} from "@symphoneer/contracts";
import { z } from "zod";

import { RuntimeError } from "../errors.ts";
import { bindOrchestrationDefinition } from "./hash.ts";

export function loadOrchestrationDefinitionSync(
  options: { id?: string; path?: string; cwd?: string } = {},
): { definition: OrchestrationDefinition; binding: OrchestrationBinding; path: string } {
  const id = options.id ?? "plan-implement-review";
  const filePath = resolve(
    options.cwd ?? process.cwd(),
    options.path ?? `.symphoneer/orchestrations/${id}.json`,
  );
  let source: string;
  try {
    source = readFileSync(filePath, "utf8");
  } catch {
    throw new RuntimeError("not_found", `Cannot read orchestration definition ${filePath}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    throw new RuntimeError("invalid_request", `Orchestration JSON is invalid: ${filePath}`);
  }
  const parsed = OrchestrationDefinitionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new RuntimeError(
      "invalid_request",
      `Orchestration definition failed validation: ${z.prettifyError(parsed.error)}`,
    );
  }
  if (parsed.data.id !== id && !options.path) {
    throw new RuntimeError(
      "invalid_request",
      `Orchestration id mismatch: expected ${id}, got ${parsed.data.id}`,
    );
  }
  return {
    definition: parsed.data,
    binding: bindOrchestrationDefinition(parsed.data),
    path: filePath,
  };
}

export async function loadOrchestrationDefinition(
  options: { id?: string; path?: string; cwd?: string } = {},
): Promise<{ definition: OrchestrationDefinition; binding: OrchestrationBinding; path: string }> {
  return loadOrchestrationDefinitionSync(options);
}

export type { OrchestrationBinding, OrchestrationDefinition };
