import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { asRecord, stringField } from "../executor/codex-app-server/protocol.ts";
import { initializeCodexTransport } from "../executor/codex-app-server/session.ts";
import { StdioCodexTransport } from "../executor/codex-app-server/transport.ts";

const execFileAsync = promisify(execFile);
const CODEX_THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function openCodexThread(threadId: string): Promise<void> {
  const id = threadId.trim();
  if (!CODEX_THREAD_ID.test(id)) throw new Error("Codex Thread ID is invalid");
  if (process.platform !== "darwin") throw new Error("Opening Codex is only available on macOS");

  await restoreCodexThreadIfArchived(id);
  // LaunchServices must dispatch the URL; forcing the bundle can activate Codex without routing it.
  await execFileAsync("/usr/bin/open", [`codex://threads/${id}`]);
}

async function restoreCodexThreadIfArchived(threadId: string): Promise<void> {
  const transport = await StdioCodexTransport.start();
  try {
    await initializeCodexTransport(transport);
    let cursor: string | null = null;
    do {
      const response = asRecord(
        await transport.request("thread/list", {
          archived: true,
          limit: 100,
          ...(cursor ? { cursor } : {}),
        }),
      );
      const threads = Array.isArray(response?.data) ? response.data : [];
      if (threads.some((thread) => stringField(thread, "id") === threadId)) {
        await transport.request("thread/unarchive", { threadId });
        return;
      }
      cursor = stringField(response, "nextCursor");
    } while (cursor);
  } finally {
    await transport.close();
  }
}
