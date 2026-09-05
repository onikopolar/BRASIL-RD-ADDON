"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = void 0;
class Logger {
    constructor(context) {
        this.context = context;
        this.logLevel = process.env.LOG_LEVEL || 'info';
    }
    shouldLog(level) {
        const levels = ['error', 'warn', 'info', 'debug'];
        const currentIndex = levels.indexOf(this.logLevel);
        const messageIndex = levels.indexOf(level);
        if (currentIndex === -1 || messageIndex === -1)
            return false;
        return messageIndex <= currentIndex;
    }
    log(level, message, ...args) {
        if (!this.shouldLog(level))
            return;
        const timestamp = new Date().toISOString();
        const prefix = `[${level.toUpperCase()}] [${this.context}] ${timestamp}`;
        const consoleMethod = console[level] || console.log;
        consoleMethod(prefix, message, ...args);
    }
    info(message, ...args) {
        this.log('info', message, ...args);
    }
    error(message, ...args) {
        this.log('error', message, ...args);
    }
    warn(message, ...args) {
        this.log('warn', message, ...args);
    }
    debug(message, ...args) {
        this.log('debug', message, ...args);
    }
}
exports.Logger = Logger;
