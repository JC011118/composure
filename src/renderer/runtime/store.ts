/** Minimal external store for useSyncExternalStore. */
export class Store<T> {
  private listeners = new Set<() => void>();
  constructor(private value: T) {}

  get = (): T => this.value;

  set(next: T): void {
    if (Object.is(next, this.value)) return;
    this.value = next;
    for (const l of this.listeners) l();
  }

  update(fn: (prev: T) => T): void {
    this.set(fn(this.value));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}
