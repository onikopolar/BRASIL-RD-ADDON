export declare class Logger {
    private context;
    private logLevel;
    constructor(context: string);
    private shouldLog;
    info(message: string, meta?: any): void;
    error(message: string, error?: any): void;
    warn(message: string, meta?: any): void;
    debug(message: string, meta?: any): void;
}
