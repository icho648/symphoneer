import type { TaskSummary } from "@symphoneer/contracts";

import type { TaskSnapshot, Tracker } from "../../src/runtime/tracker/tracker.ts";
import { TrackerError } from "../../src/runtime/tracker/tracker.ts";

export class FakeTracker implements Tracker {
  readonly kind = "fake";
  readonly requests: string[] = [];
  readonly #tasks: Map<string, TaskSnapshot>;

  constructor(
    entries: Array<{ nativeId: string; task: TaskSummary; versionToken?: string | null }>,
  ) {
    this.#tasks = new Map(
      entries.map((entry) => [
        entry.nativeId,
        {
          task: structuredClone(entry.task),
          versionToken: entry.versionToken ?? null,
        },
      ]),
    );
  }

  async getTask(
    nativeId: string,
    options: { expectedUpdatedAt?: string; signal?: AbortSignal } = {},
  ): Promise<TaskSnapshot> {
    this.requests.push(nativeId);
    options.signal?.throwIfAborted();
    const snapshot = this.#tasks.get(nativeId);
    if (!snapshot) {
      throw new TrackerError("not_found", false, `Task ${nativeId} was not found`);
    }
    if (options.expectedUpdatedAt && options.expectedUpdatedAt !== snapshot.task.updatedAt) {
      throw new TrackerError(
        "tracker_conflict",
        true,
        "Tracker Task changed after the caller's observed version",
      );
    }
    return structuredClone(snapshot);
  }
}
