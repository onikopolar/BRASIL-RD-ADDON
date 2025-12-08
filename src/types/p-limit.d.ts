declare module 'p-limit' {
  interface Limit {
    <T>(fn: () => PromiseLike<T>): Promise<T>;
    activeCount: number;
    pendingCount: number;
    clearQueue: () => void;
  }

  function pLimit(concurrency: number): Limit;
  export = pLimit;
}
