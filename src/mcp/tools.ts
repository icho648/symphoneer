import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RuntimeClient } from "@symphoneer/runtime-client";

import { registerMutationTools } from "./mutation-tools.ts";
import { registerQueryTools } from "./query-tools.ts";
import { registerUiResources } from "./resources.ts";

/** Register #16 query tools, mutation tools, and optional MCP Apps resources. */
export function registerMcpTools(server: McpServer, client: RuntimeClient): void {
  registerQueryTools(server, client);
  registerMutationTools(server, client);
  registerUiResources(server);
}
