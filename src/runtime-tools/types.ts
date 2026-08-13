import type { RuntimeClient } from "@symphoneer/runtime-client";
import type { z } from "zod";

export type ToolApproval = "none" | "required";

export interface RuntimeToolDefinition<TSchema extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  inputSchema: TSchema;
  approval: ToolApproval;
  readOnly: boolean;
  prepare?: (runtime: RuntimeClient, input: z.infer<TSchema>) => Promise<z.infer<TSchema>>;
  execute: (runtime: RuntimeClient, input: z.infer<TSchema>) => Promise<unknown>;
}

export function defineRuntimeTool<TSchema extends z.ZodType>(
  tool: RuntimeToolDefinition<TSchema>,
): RuntimeToolDefinition<TSchema> {
  return tool;
}
