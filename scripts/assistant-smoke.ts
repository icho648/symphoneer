#!/usr/bin/env node
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type AssistantClient,
  type AssistantEvent,
  createHttpAssistantClient,
} from "@symphoneer/assistant-client";
import { PiAssistantService } from "../src/assistant/index.ts";
import { RuntimeHttpServer, RuntimeService } from "../src/runtime/index.ts";

const HOST_FLAG = "--assistant-smoke-host";
const SESSION_TOKEN = "assistant-smoke-local-token";

if (process.argv[2] === HOST_FLAG) {
  await serveHost(process.argv[3]);
} else if (import.meta.main) {
  await runSmoke();
}

async function runSmoke(): Promise<void> {
  const apiKey = process.env.SYMPHONEER_ASSISTANT_API_KEY;
  if (!apiKey) throw new Error("SYMPHONEER_ASSISTANT_API_KEY is required for Assistant Smoke");
  const provider = process.env.SYMPHONEER_ASSISTANT_PROVIDER || "deepseek";
  const model = process.env.SYMPHONEER_ASSISTANT_MODEL || "deepseek-v4-flash";
  const root = await mkdtemp(join(tmpdir(), "symphoneer-assistant-smoke-"));
  const env = {
    ...process.env,
    SYMPHONEER_ASSISTANT: "1",
    SYMPHONEER_ASSISTANT_PROVIDER: provider,
    SYMPHONEER_ASSISTANT_MODEL: model,
  };
  let host: SmokeHost | undefined;

  try {
    host = await startHost(root, env);
    const status = await host.client.status();
    assert.equal(status.state, "ready");
    if (status.state !== "ready") throw new Error("Assistant did not become ready");
    assert.equal(status.provider, provider);
    assert.equal(status.model, model);
    assert.ok(status.models.some((option) => option.id === model));
    const session = await host.client.createSession({
      createdBy: "tui",
      locale: "en-US",
      taskId: "assistant-smoke",
    });
    const first = await collect(
      host.client,
      session.id,
      "Call the runtime_health tool now. After it succeeds, briefly confirm that Runtime is healthy.",
    );
    assert.ok(
      first.some(
        (event) =>
          event.type === "tool_completed" && event.toolName === "runtime_health" && !event.isError,
      ),
      "runtime_health was not called successfully",
    );
    assert.equal(first.at(-1)?.type, "completed");
    assertNoCredential(first, apiKey);

    await stopHost(host);
    host = await startHost(root, env);
    assert.ok((await host.client.listSessions()).some((item) => item.id === session.id));
    const restored = await host.client.openSession(session.id);
    assert.ok(
      restored.messages.some((message) =>
        message.parts.some(
          (part) => part.type === "tool_result" && part.toolName === "runtime_health",
        ),
      ),
      "restored session does not contain runtime_health",
    );
    const second = await collect(
      host.client,
      session.id,
      "Continue this recovered session and confirm you remember the prior Runtime health check.",
    );
    assert.equal(second.at(-1)?.type, "completed");
    assert.ok(second.some((event) => event.type === "text_delta"));
    assertNoCredential({ restored, second }, apiKey);

    await stopHost(host);
    host = undefined;
    await assertCredentialAbsent(root, apiKey);
    process.stdout.write(
      `${JSON.stringify({
        status: "passed",
        provider,
        model,
        sessionId: session.id,
        tool: "runtime_health",
        restarted: true,
        credentialScan: "clean",
      })}\n`,
    );
  } finally {
    if (host) await stopHost(host);
    await rm(root, { recursive: true, force: true });
  }
}

async function serveHost(dataDir: string | undefined): Promise<void> {
  if (!dataDir) process.exit(2);
  const assistant = new PiAssistantService({ dataDir });
  const server = new RuntimeHttpServer(new RuntimeService({ dataDir: join(dataDir, "runtime") }), {
    assistantHandler: assistant.handle,
    sessionToken: SESSION_TOKEN,
  });
  const endpoint = await server.listen();
  assistant.connectRuntime({ baseUrl: endpoint.url, token: SESSION_TOKEN });
  process.stdout.write(`${endpoint.url}\n`);

  const close = async () => {
    await assistant.close();
    await server.close();
  };
  process.once("SIGTERM", () => void close().then(() => process.exit(0)));
  process.once("SIGINT", () => void close().then(() => process.exit(0)));
}

type SmokeHost = {
  child: ChildProcess;
  client: AssistantClient;
};

async function startHost(dataDir: string, env: NodeJS.ProcessEnv): Promise<SmokeHost> {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), HOST_FLAG, dataDir], {
    env,
    stdio: ["ignore", "pipe", "ignore"],
  });
  try {
    const baseUrl = await new Promise<string>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(
        () => reject(new Error("Assistant Smoke host did not start")),
        30_000,
      );
      child.once("exit", () => reject(new Error("Assistant Smoke host exited before startup")));
      child.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
        const line = output.split(/\r?\n/, 1)[0]?.trim();
        if (!line) return;
        clearTimeout(timer);
        resolve(new URL(line).href);
      });
    });
    return {
      child,
      client: createHttpAssistantClient({ baseUrl, token: SESSION_TOKEN }),
    };
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }
}

async function stopHost(host: SmokeHost): Promise<void> {
  if (host.child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => host.child.once("exit", () => resolve()));
  host.child.kill("SIGTERM");
  const timeout = new Promise<void>((resolve) => {
    setTimeout(() => {
      host.child.kill("SIGKILL");
      resolve();
    }, 10_000).unref();
  });
  await Promise.race([exited, timeout]);
}

async function collect(
  client: AssistantClient,
  sessionId: string,
  prompt: string,
): Promise<AssistantEvent[]> {
  const events: AssistantEvent[] = [];
  for await (const event of client.run(sessionId, prompt, {
    signal: AbortSignal.timeout(120_000),
  })) {
    events.push(event);
  }
  return events;
}

function assertNoCredential(value: unknown, apiKey: string): void {
  assert.equal(JSON.stringify(value).includes(apiKey), false, "credential appeared in API data");
}

async function assertCredentialAbsent(root: string, apiKey: string): Promise<void> {
  const needle = Buffer.from(apiKey);
  for (const path of await filesUnder(root)) {
    if ((await stat(path)).isFile()) {
      assert.equal((await readFile(path)).includes(needle), false, "credential appeared on disk");
    }
  }
}

async function filesUnder(directory: string): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await filesUnder(path)));
    else paths.push(path);
  }
  return paths;
}
