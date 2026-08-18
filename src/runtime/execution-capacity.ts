export class ProcessExecutionCapacity {
  readonly #limit: number;
  readonly #owners = new Set<string>();

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("Process execution capacity must be a positive integer");
    }
    this.#limit = limit;
  }

  acquire(owner: string): boolean {
    if (this.#owners.has(owner)) return true;
    if (this.#owners.size >= this.#limit) return false;
    this.#owners.add(owner);
    return true;
  }

  release(owner: string): void {
    this.#owners.delete(owner);
  }
}
