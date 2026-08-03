import { createHash } from "node:crypto";

import { CoreError } from "./types.ts";

const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

// ponytail: bounded process-local replay; external writes will require a persistent operation ledger.
const MAX_IDEMPOTENCY_ENTRIES = 1_000;

export class ReplayCache {
  readonly #entries = new Map<string, { fingerprint: string; result: unknown }>();

  run<T>(key: string, request: unknown, operation: () => T): T {
    const requestFingerprint = fingerprint(request);
    const existing = this.#entries.get(key);
    if (existing) {
      if (existing.fingerprint !== requestFingerprint) {
        throw new CoreError("conflict", `Idempotency key ${key} was reused for another request`);
      }
      return structuredClone(existing.result) as T;
    }

    const result = operation();
    this.#entries.set(key, { fingerprint: requestFingerprint, result: structuredClone(result) });
    if (this.#entries.size > MAX_IDEMPOTENCY_ENTRIES) {
      const oldest = this.#entries.keys().next().value;
      if (oldest != null) this.#entries.delete(oldest);
    }
    return structuredClone(result);
  }
}
