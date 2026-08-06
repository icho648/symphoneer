#!/usr/bin/env node
import {
  resolveRuntimeHostConfig,
  RuntimeHttpServer,
  RuntimeService,
} from "./index.ts";

export async function runServer(
  options: {
    dataDir?: string;
    host?: "127.0.0.1" | "localhost" | "::1";
    port?: number;
    uiDistDir?: string;
    sessionToken?: string;
    stdout?: NodeJS.WritableStream;
  } = {},
): Promise<void> {
  const stdout = options.stdout ?? process.stdout;
  const hostConfig = await resolveRuntimeHostConfig({
    ...(options.dataDir ? { dataDir: options.dataDir } : {}),
    ...(options.host ? { host: options.host } : {}),
    ...(options.port !== undefined ? { port: options.port } : {}),
    ...(options.uiDistDir ? { uiDistDir: options.uiDistDir } : {}),
    ...(options.sessionToken ? { sessionToken: options.sessionToken } : {}),
  });
  const runtimeId = process.env.SYMPHONEER_RUNTIME_ID;
  const service = new RuntimeService({
    dataDir: hostConfig.dataDir,
    ...(runtimeId ? { runtimeId } : {}),
  });
  const server = new RuntimeHttpServer(service, {
    host: hostConfig.transport.host,
    port: hostConfig.transport.port,
    sessionToken: hostConfig.credentials.sessionToken,
    ...(hostConfig.uiDistDir ? { uiDistDir: hostConfig.uiDistDir } : {}),
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

if (import.meta.main) {
  runServer().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Runtime serve failed"}\n`);
    process.exitCode = 1;
  });
}
