import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RuntimeClient } from "@symphoneer/runtime-client";

import { resolveRuntimeUrl } from "./loopback.ts";
import { registerMcpTools } from "./tools.ts";

export type CreateSymphoneerMcpServerOptions = {
  client?: RuntimeClient;
  runtimeUrl?: string;
};

/** Build an MCP server that only talks to loopback Runtime via RuntimeClient. */
export function createSymphoneerMcpServer(
  options: CreateSymphoneerMcpServerOptions = {},
): McpServer {
  const client =
    options.client ?? new RuntimeClient({ baseUrl: resolveRuntimeUrl(options.runtimeUrl) });
  const server = new McpServer({
    name: "symphoneer",
    version: "0.0.0",
  });
  registerMcpTools(server, client);
  return server;
}

/** Start STDIO transport for Hosts such as Codex. */
export async function serveSymphoneerMcp(
  options: CreateSymphoneerMcpServerOptions = {},
): Promise<McpServer> {
  const server = createSymphoneerMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return server;
}
