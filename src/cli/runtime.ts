#!/usr/bin/env node
import { RuntimeClient } from "@symphoneer/runtime-client";

/** Human-facing Runtime query CLI (snapshot / events / attempt). Not the Runtime process entry. */
export async function runCli(
  argv: readonly string[],
  options: { client?: RuntimeClient; stdout?: NodeJS.WritableStream } = {},
): Promise<void> {
  const stdout = options.stdout ?? process.stdout;
  const command = argv[0] ?? "snapshot";
  const client =
    options.client ??
    new RuntimeClient({
      baseUrl: process.env.SYMPHONEER_RUNTIME_URL ?? "http://127.0.0.1:4318",
    });
  if (command === "snapshot") {
    stdout.write(`${JSON.stringify(await client.snapshot(), null, 2)}\n`);
    return;
  }
  if (command === "events") {
    const after = Number(argv[1] ?? 0);
    stdout.write(`${JSON.stringify(await client.events(after), null, 2)}\n`);
    return;
  }
  if (command === "attempt" && argv[1]) {
    stdout.write(`${JSON.stringify(await client.attempt(argv[1]), null, 2)}\n`);
    return;
  }
  throw new Error("Usage: pnpm runtime:cli [snapshot|events [after]|attempt <attempt-id>]");
}

if (import.meta.main) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Runtime CLI failed"}\n`);
    process.exitCode = 1;
  });
}
