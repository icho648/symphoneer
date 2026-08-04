#!/usr/bin/env node
import { RuntimeClient } from "./client.ts";
import { RuntimeHttpServer, type RuntimeHttpServerOptions } from "./http.ts";
import { RuntimeService } from "./service.ts";

export async function runServer(
  options: {
    dataDir?: string;
    host?: RuntimeHttpServerOptions["host"];
    port?: number;
    stdout?: NodeJS.WritableStream;
  } = {},
): Promise<void> {
  const dataDir = options.dataDir ?? process.env.SYMPHONEER_DATA_DIR;
  if (!dataDir) throw new Error("SYMPHONEER_DATA_DIR is required to start Runtime");
  const stdout = options.stdout ?? process.stdout;
  const runtimeId = process.env.SYMPHONEER_RUNTIME_ID;
  const service = new RuntimeService({ dataDir, ...(runtimeId ? { runtimeId } : {}) });
  const server = new RuntimeHttpServer(service, {
    host: options.host ?? parseHost(process.env.SYMPHONEER_RUNTIME_HOST),
    port: options.port ?? parsePort(process.env.SYMPHONEER_RUNTIME_PORT),
  });
  const stopped = Promise.withResolvers<void>();
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void server.close().then(stopped.resolve, stopped.reject);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const endpoint = await server.listen();
  stdout.write(`Runtime running at ${endpoint.url} (pid ${process.pid})\n`);
  try {
    await stopped.promise;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

export async function runCli(
  argv: readonly string[],
  options: { client?: RuntimeClient; stdout?: NodeJS.WritableStream } = {},
): Promise<void> {
  const stdout = options.stdout ?? process.stdout;
  const command = argv[0] ?? "snapshot";
  if (command === "serve") {
    await runServer({ stdout });
    return;
  }
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
  throw new Error("Usage: symphoneer-runtime [serve|snapshot|events [after]|attempt <attempt-id>]");
}

function parseHost(value: string | undefined): NonNullable<RuntimeHttpServerOptions["host"]> {
  if (!value || value === "127.0.0.1") return "127.0.0.1";
  if (value === "localhost" || value === "::1") return value;
  throw new Error("SYMPHONEER_RUNTIME_HOST must be 127.0.0.1, localhost, or ::1");
}

function parsePort(value: string | undefined): number {
  if (!value) return 4318;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("SYMPHONEER_RUNTIME_PORT must be an integer from 0 to 65535");
  }
  return port;
}

if (import.meta.main) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Runtime CLI failed"}\n`);
    process.exitCode = 1;
  });
}
