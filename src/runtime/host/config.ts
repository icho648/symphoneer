import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

const LoopbackHostSchema = z.enum(["127.0.0.1", "localhost", "::1"]);

export const RuntimeHostConfigSchema = z.object({
  dataDir: z.string().min(1),
  cacheDir: z.string().min(1),
  logDir: z.string().min(1),
  workspaceRoot: z.string().min(1),
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

/** Resolve platform-owned roots once. Project identity and layout belong to ApplicationData. */
export async function resolveRuntimeHostConfig(
  options: {
    dataDir?: string;
    cacheDir?: string;
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
  const rawDataDir = options.dataDir ?? env.SYMPHONEER_DATA_DIR;
  if (!rawDataDir) throw new Error("SYMPHONEER_DATA_DIR is required to start Runtime");
  const dataDir = resolve(rawDataDir);
  const cacheDir = resolve(
    options.cacheDir ?? env.SYMPHONEER_CACHE_DIR ?? resolve(dataDir, "cache"),
  );
  const logDir = resolve(options.logDir ?? env.SYMPHONEER_LOG_DIR ?? resolve(dataDir, "logs"));
  const workspaceRoot = resolve(
    options.workspaceRoot ?? env.SYMPHONEER_WORKSPACE_ROOT ?? resolve(dataDir, "workspaces"),
  );
  const uiDistDir = options.uiDistDir ?? env.SYMPHONEER_UI_DIST_DIR;
  const host = LoopbackHostSchema.parse(options.host ?? env.SYMPHONEER_RUNTIME_HOST ?? "127.0.0.1");
  const port = options.port ?? parsePort(env.SYMPHONEER_RUNTIME_PORT);

  await Promise.all([
    mkdir(dataDir, { recursive: true }),
    mkdir(cacheDir, { recursive: true }),
    mkdir(logDir, { recursive: true }),
    mkdir(workspaceRoot, { recursive: true }),
  ]);
  const sessionToken = await resolveSessionToken(
    resolve(dataDir, "runtime-token"),
    options.sessionToken ?? env.SYMPHONEER_RUNTIME_TOKEN,
  );

  return RuntimeHostConfigSchema.parse({
    dataDir,
    cacheDir,
    logDir,
    workspaceRoot,
    ...(uiDistDir ? { uiDistDir } : {}),
    transport: { kind: "http", host, port },
    credentials: { sessionToken },
  });
}

async function resolveSessionToken(path: string, explicit: string | undefined): Promise<string> {
  let token = explicit;
  if (!token) {
    try {
      token = (await readFile(path, "utf8")).trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  token ||= randomBytes(24).toString("base64url");
  if (token.length < 16) throw new Error("SYMPHONEER_RUNTIME_TOKEN must contain 16 characters");
  await writeFile(path, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  return token;
}

function parsePort(value: string | undefined): number {
  if (!value) return 4318;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("SYMPHONEER_RUNTIME_PORT must be an integer from 0 to 65535");
  }
  return port;
}
