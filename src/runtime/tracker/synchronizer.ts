import { type RuntimeEvent, type TaskSummary, TaskSummarySchema } from "@symphoneer/contracts";
import type { EventLog } from "../service/event-log.ts";
import type { TaskSnapshot, Tracker } from "./tracker.ts";

/** Project-scoped Tracker synchronization dependencies. */
export interface TrackerSynchronizerOptions {
  log: EventLog;
  tracker: Tracker;
  taskMatches?: (task: TaskSummary) => boolean;
  reconcile?: (tasks: readonly TaskSnapshot["task"][]) => Promise<void>;
}

export interface TrackerSyncResult {
  taskCount: number;
  pageCount: number;
}

export class TrackerSynchronizer {
  readonly #log: EventLog;
  readonly #tracker: Tracker;
  readonly #taskMatches: (task: TaskSummary) => boolean;
  readonly #reconcile: TrackerSynchronizerOptions["reconcile"];
  #abortController: AbortController | undefined;
  #inFlight: Promise<TrackerSyncResult> | undefined;

  constructor(options: TrackerSynchronizerOptions) {
    this.#log = options.log;
    this.#tracker = options.tracker;
    this.#taskMatches = options.taskMatches ?? (() => true);
    this.#reconcile = options.reconcile;
  }

  refresh(signal?: AbortSignal): Promise<TrackerSyncResult> {
    if (this.#inFlight) return this.#inFlight;
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    this.#abortController = abortController;
    this.#inFlight = (async () => {
      const result = await this.#log.withMutation(() =>
        syncTrackerProjection(this.#log, this.#tracker, abortController.signal, this.#taskMatches),
      );
      await this.#reconcile?.(result.tasks);
      return { taskCount: result.tasks.length, pageCount: result.pageCount };
    })().finally(() => {
      signal?.removeEventListener("abort", abort);
      this.#abortController = undefined;
      this.#inFlight = undefined;
    });
    return this.#inFlight;
  }

  async stop(): Promise<void> {
    this.#abortController?.abort();
    await this.#inFlight?.catch(() => undefined);
  }
}

export async function syncTrackerProjection(
  log: EventLog,
  tracker: Tracker,
  signal?: AbortSignal,
  taskMatches: (task: TaskSummary) => boolean = () => true,
): Promise<{ tasks: TaskSnapshot["task"][]; pageCount: number; events: RuntimeEvent[] }> {
  if (!tracker.listTasks) throw new Error("Tracker full synchronization is not configured");
  const tasks: TaskSnapshot["task"][] = [];
  const events: RuntimeEvent[] = [];
  const seenTaskIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let pageCount = 0;
  do {
    if (cursor && seenCursors.has(cursor)) throw new Error("Tracker pagination cursor repeated");
    if (cursor) seenCursors.add(cursor);
    const page = await tracker.listTasks({
      ...(cursor ? { cursor } : {}),
      ...(signal ? { signal } : {}),
    });
    pageCount += 1;
    for (const snapshot of page.tasks) {
      const task = TaskSummarySchema.parse(snapshot.task);
      const returning =
        log.projection.getTask(task.id)?.dispatchable === false && task.dispatchable;
      tasks.push(task);
      seenTaskIds.add(task.id);
      const event = await log.commit({
        type: "task.changed",
        source: "adapter",
        aggregate: { kind: "task", id: task.id },
        taskId: task.id,
        idempotencyKey: `tracker-change:${task.id}:${task.updatedAt ?? ""}${returning ? `:returning:${log.lastSequence}` : ""}`,
        payload: { taskId: task.id, versionToken: snapshot.versionToken },
      });
      log.projection.recordTask(task);
      events.push(event);
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  for (const existing of log.projection.tasks()) {
    if (
      existing.source.kind !== tracker.kind ||
      !taskMatches(existing) ||
      seenTaskIds.has(existing.id) ||
      !existing.dispatchable
    )
      continue;
    const unavailable = TaskSummarySchema.parse({ ...existing, dispatchable: false });
    const event = await log.commit({
      type: "task.changed",
      source: "adapter",
      aggregate: { kind: "task", id: unavailable.id },
      taskId: unavailable.id,
      idempotencyKey: `tracker-change:missing:${unavailable.id}:${unavailable.updatedAt ?? ""}:${log.lastSequence}`,
      payload: { taskId: unavailable.id, versionToken: null },
    });
    log.projection.recordTask(unavailable);
    events.push(event);
  }
  return { tasks, pageCount, events };
}
