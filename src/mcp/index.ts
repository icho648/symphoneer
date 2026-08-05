import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RuntimeClient, RuntimeClientError } from "@symphoneer/runtime-client";

import { UI_RESOURCES } from "./resources.ts";
import {
  ALL_TOOLS,
  FORBIDDEN_TOOL_NAMES,
  MUTATION_TOOLS,
  QUERY_TOOLS,
  registerMcpTools,
} from "./tools.ts";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export type CreateSymphoneerMcpServerOptions = {
  client?: RuntimeClient;
  runtimeUrl?: string;
};

/** Resolve and enforce loopback-only Runtime HTTP URL for MCP. */
export function resolveRuntimeUrl(value = process.env.SYMPHONEER_RUNTIME_URL): string {
  const raw = value ?? "http://127.0.0.1:4318";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RuntimeClientError(0, "invalid_runtime_url", "Runtime URL is invalid");
  }
  const hostname = url.hostname.replace(/^\[(.*)\]$/, "$1");
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(hostname)) {
    throw new RuntimeClientError(0, "invalid_runtime_url", "Runtime must stay on loopback HTTP");
  }
  return url.href.replace(/\/$/, "");
}

/** Build an MCP server that only talks to loopback Runtime via RuntimeClient. */
export function createSymphoneerMcpServer(
  options: CreateSymphoneerMcpServerOptions = {},
): McpServer {
  const client =
    options.client ?? new RuntimeClient({ baseUrl: resolveRuntimeUrl(options.runtimeUrl) });
  const server = new McpServer({ name: "symphoneer", version: "0.0.0" });
  registerMcpTools(server, client);
  return server;
}

/** Start STDIO transport for Hosts such as Codex. */
export async function serveSymphoneerMcp(
  options: CreateSymphoneerMcpServerOptions = {},
): Promise<McpServer> {
  const server = createSymphoneerMcpServer(options);
  await server.connect(new StdioServerTransport());
  return server;
}

export { ALL_TOOLS, FORBIDDEN_TOOL_NAMES, MUTATION_TOOLS, QUERY_TOOLS, UI_RESOURCES };
