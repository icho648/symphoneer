export interface ProjectPollingJob {
  projectId: string;
  intervalMs: number;
  poll: (signal: AbortSignal) => Promise<void>;
}

interface RegisteredJob extends ProjectPollingJob {
  abortController: AbortController | undefined;
  failures: number;
  inFlight: Promise<void> | undefined;
  nextRunAt: number;
}

/** Owns application-level polling cadence while projects own synchronization behavior. */
export class ProjectPollingCoordinator {
  readonly #jobs = new Map<string, RegisteredJob>();
  // ponytail: one global poll slot; add bounded parallel slots only if sync latency becomes measurable.
  #queue: Promise<void> = Promise.resolve();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #started = false;

  register(job: ProjectPollingJob): () => void {
    if (this.#jobs.has(job.projectId)) throw new Error(`Project ${job.projectId} is registered`);
    const registered: RegisteredJob = {
      ...job,
      abortController: undefined,
      failures: 0,
      inFlight: undefined,
      intervalMs: Math.max(1_000, job.intervalMs),
      nextRunAt: Date.now(),
    };
    this.#jobs.set(job.projectId, registered);
    this.#schedule();
    return () => {
      registered.abortController?.abort();
      this.#jobs.delete(job.projectId);
      this.#schedule();
    };
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    for (const job of this.#jobs.values()) job.nextRunAt = Date.now();
    await this.#runDue();
    this.#schedule();
  }

  async refresh(projectId: string): Promise<void> {
    const job = this.#jobs.get(projectId);
    if (!job) throw new Error(`Project ${projectId} has no polling job`);
    if (job.inFlight) return job.inFlight;
    const queued = this.#queue.then(async () => {
      if (!this.#started || this.#jobs.get(projectId) !== job) return;
      const abortController = new AbortController();
      job.abortController = abortController;
      try {
        await job.poll(abortController.signal);
        job.failures = 0;
      } catch (error) {
        job.failures += 1;
        throw error;
      } finally {
        job.abortController = undefined;
        const delay = Math.min(job.intervalMs * 2 ** Math.min(job.failures, 5), 5 * 60_000);
        job.nextRunAt = Date.now() + delay;
      }
    });
    job.inFlight = queued.finally(() => {
      job.inFlight = undefined;
      this.#schedule();
    });
    this.#queue = job.inFlight.catch(() => undefined);
    return job.inFlight;
  }

  async stop(): Promise<void> {
    this.#started = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    for (const job of this.#jobs.values()) job.abortController?.abort();
    await this.#queue;
  }

  async #runDue(): Promise<void> {
    const now = Date.now();
    for (const job of this.#jobs.values()) {
      if (job.nextRunAt <= now) await this.refresh(job.projectId).catch(() => undefined);
    }
  }

  #schedule(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    if (!this.#started) return;
    const nextRunAt = Math.min(
      ...[...this.#jobs.values()].filter((job) => !job.inFlight).map((job) => job.nextRunAt),
    );
    if (!Number.isFinite(nextRunAt)) return;
    this.#timer = setTimeout(
      () => {
        this.#timer = undefined;
        void this.#runDue().finally(() => this.#schedule());
      },
      Math.max(0, nextRunAt - Date.now()),
    );
    this.#timer.unref?.();
  }
}
