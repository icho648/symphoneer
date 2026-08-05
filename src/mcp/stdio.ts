#!/usr/bin/env node
import { serveSymphoneerMcp } from "./index.ts";

/** STDIO process entry for MCP Hosts (Codex, etc.). */
export async function runMcp(): Promise<void> {
  await serveSymphoneerMcp();
}

if (import.meta.main) {
  runMcp().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "MCP server failed"}\n`);
    process.exitCode = 1;
  });
}
