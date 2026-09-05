export class Logger {
  private context: string;
  private logLevel: string;

  constructor(context: string) {
    this.context = context;
    this.logLevel = process.env.LOG_LEVEL || 'info';
  }

  private shouldLog(level: string): boolean {
    const levels = ['error', 'warn', 'info', 'debug'];
    const currentIndex = levels.indexOf(this.logLevel);
    const messageIndex = levels.indexOf(level);
    if (currentIndex === -1 || messageIndex === -1) return false;
    return messageIndex <= currentIndex;
  }

  private log(level: 'error' | 'warn' | 'info' | 'debug', message: string, ...args: any[]): void {
    if (!this.shouldLog(level)) return;
    const timestamp = new Date().toISOString();
    const prefix = `[${level.toUpperCase()}] [${this.context}] ${timestamp}`;
    const consoleMethod = console[level] || console.log;
    consoleMethod(prefix, message, ...args);
  }

  info(message: string, ...args: any[]): void {
    this.log('info', message, ...args);
  }

  error(message: string, ...args: any[]): void {
    this.log('error', message, ...args);
  }

  warn(message: string, ...args: any[]): void {
    this.log('warn', message, ...args);
  }

  debug(message: string, ...args: any[]): void {
    this.log('debug', message, ...args);
  }
}