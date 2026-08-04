import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";

import {
  type DomainEventEnvelope,
  DomainEventEnvelopeSchema,
  type RuntimeEvent,
  RuntimeEventSchema,
} from "@symphoneer/contracts";
import { RuntimeError } from "./errors.ts";
import { isKnownDomainEventType } from "./events.ts";

const isMissing = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

export class JsonlEventStore {
  readonly #path: string;
  #tail: Promise<unknown> = Promise.resolve();
  #initialized = false;
  #sequence = 0;
  #eventIds = new Set<string>();
  #idempotencyKeys = new Set<string>();

  constructor(root: string) {
    this.#path = resolve(root, "events", "domain-events.jsonl");
  }

  async replay(): Promise<RuntimeEvent[]> {
    return this.#serialize(async () => {
      const events = await this.#read();
      this.#remember(events);
      this.#initialized = true;
      this.#sequence = events.length;
      return events;
    });
  }

  async append(input: DomainEventEnvelope): Promise<RuntimeEvent> {
    const event = DomainEventEnvelopeSchema.parse(input);
    if (!isKnownDomainEventType(event.type)) {
      throw new RuntimeError("unknown_event", `Unknown domain event type: ${event.type}`);
    }
    return this.#serialize(async () => {
      if (!this.#initialized) {
        const existing = await this.#read();
        this.#remember(existing);
        this.#sequence = existing.length;
        this.#initialized = true;
      }
      if (this.#eventIds.has(event.id)) {
        throw new RuntimeError("duplicate_event", `Duplicate domain event: ${event.id}`);
      }
      if (event.idempotencyKey && this.#idempotencyKeys.has(event.idempotencyKey)) {
        throw new RuntimeError(
          "duplicate_event",
          `Duplicate idempotency key: ${event.idempotencyKey}`,
        );
      }
      await mkdir(dirname(this.#path), { recursive: true });
      const file = await open(this.#path, "a");
      try {
        await file.writeFile(`${JSON.stringify(event)}\n`, "utf8");
        await file.sync();
      } finally {
        await file.close();
      }
      const stored = RuntimeEventSchema.parse({ sequence: ++this.#sequence, event });
      this.#remember([stored]);
      return stored;
    });
  }

  #read(): Promise<RuntimeEvent[]> {
    return readFile(this.#path, "utf8")
      .then((contents) => {
        if (contents.length === 0) return [];
        const withoutTrailingNewline = contents.endsWith("\n") ? contents.slice(0, -1) : contents;
        if (!withoutTrailingNewline) {
          throw new RuntimeError("corrupt_event", "Blank domain event at line 1");
        }
        return withoutTrailingNewline.split("\n").map((line, index) => {
          if (!line.trim()) {
            throw new RuntimeError("corrupt_event", `Blank domain event at line ${index + 1}`);
          }
          let value: unknown;
          try {
            value = JSON.parse(line);
          } catch {
            throw new RuntimeError(
              "corrupt_event",
              `Invalid JSONL domain event at line ${index + 1}`,
            );
          }
          const parsed = DomainEventEnvelopeSchema.safeParse(value);
          if (!parsed.success) {
            throw new RuntimeError(
              "corrupt_event",
              `Invalid domain event record at line ${index + 1}`,
            );
          }
          if (!isKnownDomainEventType(parsed.data.type)) {
            throw new RuntimeError(
              "unknown_event",
              `Unknown domain event type at line ${index + 1}`,
            );
          }
          return RuntimeEventSchema.parse({ sequence: index + 1, event: parsed.data });
        });
      })
      .catch((error) => {
        if (isMissing(error)) return [];
        throw error;
      });
  }

  #remember(events: readonly RuntimeEvent[]): void {
    for (const { event } of events) {
      if (this.#eventIds.has(event.id)) {
        throw new RuntimeError("duplicate_event", `Duplicate domain event: ${event.id}`);
      }
      if (event.idempotencyKey && this.#idempotencyKeys.has(event.idempotencyKey)) {
        throw new RuntimeError(
          "duplicate_event",
          `Duplicate idempotency key: ${event.idempotencyKey}`,
        );
      }
      this.#eventIds.add(event.id);
      if (event.idempotencyKey) this.#idempotencyKeys.add(event.idempotencyKey);
    }
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const current = this.#tail.then(operation);
    this.#tail = current.then(
      () => undefined,
      () => undefined,
    );
    return current;
  }
}

export class ImmutableArtifactStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = resolve(root, "artifacts");
  }

  async put(content: string | Uint8Array, extension = "json"): Promise<string> {
    const bytes = typeof content === "string" ? Buffer.from(content) : Buffer.from(content);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const name = `${digest}.${extension.replace(/[^a-z0-9_-]/gi, "") || "bin"}`;
    const path = resolve(this.#root, name);
    await mkdir(this.#root, { recursive: true });
    try {
      const file = await open(path, "wx");
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      const existing = await readFile(path);
      if (!existing.equals(bytes)) {
        throw new RuntimeError("artifact_conflict", `Immutable artifact conflict: ${name}`);
      }
    }
    return `artifacts/${name}`;
  }

  async read(artifactRef: string): Promise<Buffer> {
    const name = artifactRef.startsWith("artifacts/") ? artifactRef.slice("artifacts/".length) : "";
    if (!name || basename(name) !== name) {
      throw new RuntimeError("invalid_path", "Artifact reference must name one immutable file");
    }
    const path = resolve(this.#root, name);
    const relativePath = relative(this.#root, path);
    if (relativePath.startsWith(`..${sep}`) || relativePath === "..") {
      throw new RuntimeError("invalid_path", "Artifact reference escapes the artifact root");
    }
    return readFile(path);
  }
}
