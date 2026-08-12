import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { redactSecrets } from "../host/security.ts";

export interface OperatorRecord {
  occurredAt: string;
  operation: string;
  outcome: "succeeded" | "failed" | "blocked";
  durationMs: number;
  taskId?: string;
  attemptId?: string;
  workspaceId?: string;
  threadId?: string;
  turnId?: string;
  pid?: number | null;
  errorKind?: string;
}

export class OperatorLog {
  readonly #path: string;
  #tail = Promise.resolve();

  constructor(path: string) {
    this.#path = resolve(path);
  }

  append(record: OperatorRecord): Promise<void> {
    const redacted = redactSecrets(record);
    const line = `${JSON.stringify({
      ...redacted,
      operation: record.operation,
      ...(record.taskId ? { taskId: record.taskId } : {}),
      ...(record.attemptId ? { attemptId: record.attemptId } : {}),
      ...(record.workspaceId ? { workspaceId: record.workspaceId } : {}),
      ...(record.threadId ? { threadId: record.threadId } : {}),
      ...(record.turnId ? { turnId: record.turnId } : {}),
      ...(record.errorKind ? { errorKind: safeErrorKind(record.errorKind) } : {}),
    })}\n`;
    const write = this.#tail.then(async () => {
      await mkdir(dirname(this.#path), { recursive: true });
      await appendFile(this.#path, line, { encoding: "utf8", mode: 0o600 });
    });
    this.#tail = write.catch(() => undefined);
    return write;
  }
}

function safeErrorKind(value: string): string {
  return /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(value) &&
    !/api[_-]?key|secret|token|authorization/i.test(value)
    ? value
    : "[redacted]";
}
