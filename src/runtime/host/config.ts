import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

const LoopbackHostSchema = z.enum(["127.0.0.1", "localhost", "::1"]);

export const RuntimeHostConfigSchema = z.object({
  dataDir: z.string().min(1),
  workspaceRoot: z.string().min(1),
  logDir: z.string().min(1),
  uiDistDir: z.string().min(1).optional(),
  transport: z.object({
    kind: z.literal("http"),
    host: LoopbackHostSchema,
    port: z.number().int().min(0).max(65_535),
  }),
  credentials: z.object({
    sessionToken: z.string().min(16),
  }),
});

export type RuntimeHostConfig = z.infer<typeof RuntimeHostConfigSchema>;

export async function resolveRuntimeHostConfig(
  options: {
    dataDir?: string;
    workspaceRoot?: string;
    logDir?: string;
    uiDistDir?: string;
    host?: string;
    port?: number;
    sessionToken?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<RuntimeHostConfig> {
  const env = options.env ?? process.env;
  const dataDir = options.dataDir ?? env.SYMPHONEER_DATA_DIR;
  if (!dataDir) throw new Error("SYMPHONEER_DATA_DIR is required to start Runtime");
  const workspaceRoot =
    options.workspaceRoot ?? env.SYMPHONEER_WORKSPACE_ROOT ?? resolve(dataDir, "workspaces");
  const logDir = options.logDir ?? env.SYMPHONEER_LOG_DIR ?? resolve(dataDir, "logs");
  const uiDistDir = options.uiDistDir ?? env.SYMPHONEER_UI_DIST_DIR;
  const host = LoopbackHostSchema.parse(options.host ?? env.SYMPHONEER_RUNTIME_HOST ?? "127.0.0.1");
  const port = options.port ?? parsePort(env.SYMPHONEER_RUNTIME_PORT);
  const sessionToken =
    options.sessionToken ?? env.SYMPHONEER_RUNTIME_TOKEN ?? randomBytes(24).toString("base64url");

  await mkdir(dataDir, { recursive: true });
  await mkdir(logDir, { recursive: true });
  await writeFile(resolve(dataDir, "runtime-token"), `${sessionToken}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });

  return RuntimeHostConfigSchema.parse({
    dataDir,
    workspaceRoot,
    logDir,
    ...(uiDistDir ? { uiDistDir } : {}),
    transport: { kind: "http", host, port },
    credentials: { sessionToken },
  });
}

function parsePort(value: string | undefined): number {
  if (!value) return 4318;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("SYMPHONEER_RUNTIME_PORT must be an integer from 0 to 65535");
  }
  return port;
}
