export class Logger {
    constructor(context) {
        this.context = context;
        this.logLevel = process.env.LOG_LEVEL || 'info';
    }
    shouldLog(level) {
        const levels = ['error', 'warn', 'info', 'debug'];
        const currentLevelIndex = levels.indexOf(this.logLevel);
        const messageLevelIndex = levels.indexOf(level);
        return messageLevelIndex <= currentLevelIndex;
    }
    info(message, meta) {
        if (this.shouldLog('info')) {
            console.log(`[INFO] [${this.context}] ${message}`, meta || '');
        }
    }
    error(message, error) {
        if (this.shouldLog('error')) {
            console.error(`[ERROR] [${this.context}] ${message}`, error || '');
        }
    }
    warn(message, meta) {
        if (this.shouldLog('warn')) {
            console.warn(`[WARN] [${this.context}] ${message}`, meta || '');
        }
    }
    debug(message, meta) {
        if (this.shouldLog('debug')) {
            console.debug(`[DEBUG] [${this.context}] ${message}`, meta || '');
        }
    }
}
