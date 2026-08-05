#!/usr/bin/env node
import { serveSymphoneerMcp } from "@symphoneer/mcp";

export async function runMcp(): Promise<void> {
  await serveSymphoneerMcp();
}

if (import.meta.main) {
  runMcp().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "MCP server failed"}\n`);
    process.exitCode = 1;
  });
}
