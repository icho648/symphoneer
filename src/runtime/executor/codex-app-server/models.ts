import { type CodexModel, CodexModelSchema } from "@symphoneer/contracts";

import { asRecord } from "./protocol.ts";
import { initializeCodexTransport } from "./session.ts";
import type { CodexTransport } from "./transport.ts";

export async function listCodexModels(transport: CodexTransport): Promise<CodexModel[]> {
  await initializeCodexTransport(transport);
  const response = asRecord(
    await transport.request("model/list", { includeHidden: false, limit: 100 }),
  );
  return CodexModelSchema.array().parse(response?.data);
}
