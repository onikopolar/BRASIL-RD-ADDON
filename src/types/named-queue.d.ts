declare module 'named-queue' {
  class NamedQueue {
    constructor(concurrency: number);
    push<T>(key: string, task: (callback: (error?: any) => void) => void): void;
    size(): number;
    clear(): void;
  }
  
  export = NamedQueue;
}
