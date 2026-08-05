/** Canonical MCP tool names for #16. Keep this list the source for audits. */
export const QUERY_TOOLS = [
  "runtime_health",
  "runtime_snapshot",
  "get_attempt",
  "list_events",
] as const;

export const MUTATION_TOOLS = ["pause_attempt", "retry_attempt", "respond_intervention"] as const;

export const ALL_TOOLS = [...QUERY_TOOLS, ...MUTATION_TOOLS] as const;

export type QueryToolName = (typeof QUERY_TOOLS)[number];
export type MutationToolName = (typeof MUTATION_TOOLS)[number];
export type McpToolName = (typeof ALL_TOOLS)[number];

export const FORBIDDEN_TOOL_NAMES = [
  "dispatch",
  "commit",
  "push",
  "merge",
  "close",
  "create_pr",
] as const;
