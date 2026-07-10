"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.queueService = exports.QueueService = void 0;
const p_limit_1 = __importDefault(require("p-limit"));
const named_queue_1 = __importDefault(require("named-queue"));
const logger_js_1 = require("../utils/logger.js");
class QueueService {
    constructor(config) {
        this.logger = new logger_js_1.Logger('QueueService');
        this.queues = new Map();
        this.namedQueues = new Map();
        this.defaultConcurrent = config?.defaultConcurrent || 5;
        this.logger.debug('QueueService ready');
    }
    getQueue(name, maxConcurrent) {
        if (!this.queues.has(name)) {
            const limit = maxConcurrent || this.defaultConcurrent;
            this.queues.set(name, (0, p_limit_1.default)(limit));
            this.logger.debug('Fila criada', { name, maxConcurrent: limit });
        }
        return this.queues.get(name);
    }
    getNamedQueue(name, maxConcurrent) {
        if (!this.namedQueues.has(name)) {
            const limit = maxConcurrent || this.defaultConcurrent;
            const queue = new named_queue_1.default(limit);
            this.namedQueues.set(name, queue);
            this.logger.debug('Fila nomeada criada', { name, maxConcurrent: limit });
        }
        return this.namedQueues.get(name);
    }
    async executeInQueue(queueName, task, taskName) {
        const queue = this.getQueue(queueName);
        const startTime = Date.now();
        this.logger.debug('Tarefa adicionada à fila', {
            queue: queueName,
            task: taskName || 'anonima',
            pending: queue.pendingCount,
            active: queue.activeCount
        });
        try {
            const result = await queue(task);
            const duration = Date.now() - startTime;
            this.logger.debug('Tarefa concluída', {
                queue: queueName,
                task: taskName || 'anonima',
                duration: `${duration}ms`,
                pending: queue.pendingCount,
                active: queue.activeCount
            });
            return result;
        }
        catch (error) {
            const duration = Date.now() - startTime;
            this.logger.error('Erro na tarefa da fila', {
                queue: queueName,
                task: taskName || 'anonima',
                duration: `${duration}ms`,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            throw error;
        }
    }
    async executeInNamedQueue(queueName, key, task, taskName) {
        const queue = this.getNamedQueue(queueName);
        const startTime = Date.now();
        this.logger.debug('Tarefa adicionada à fila nomeada', {
            queue: queueName,
            key,
            task: taskName || 'anonima',
            queueSize: queue.size()
        });
        return new Promise((resolve, reject) => {
            queue.push(key, async (callback) => {
                try {
                    const result = await task();
                    const duration = Date.now() - startTime;
                    this.logger.debug('Tarefa da fila nomeada concluída', {
                        queue: queueName,
                        key,
                        task: taskName || 'anonima',
                        duration: `${duration}ms`,
                        queueSize: queue.size()
                    });
                    resolve(result);
                    callback();
                }
                catch (error) {
                    const duration = Date.now() - startTime;
                    this.logger.error('Erro na tarefa da fila nomeada', {
                        queue: queueName,
                        key,
                        task: taskName || 'anonima',
                        duration: `${duration}ms`,
                        error: error instanceof Error ? error.message : 'Erro desconhecido'
                    });
                    reject(error);
                    callback(error);
                }
            });
        });
    }
    getQueueStats() {
        const stats = {
            genericQueues: {},
            namedQueues: {},
            totals: {
                generic: this.queues.size,
                named: this.namedQueues.size
            }
        };
        for (const [name, queue] of this.queues) {
            stats.genericQueues[name] = {
                pendingCount: queue.pendingCount,
                activeCount: queue.activeCount
            };
        }
        for (const [name, queue] of this.namedQueues) {
            stats.namedQueues[name] = {
                size: queue.size()
            };
        }
        return stats;
    }
    clearAll() {
        this.queues.clear();
        this.namedQueues.clear();
        this.logger.info('Todas as filas limpas');
    }
}
exports.QueueService = QueueService;
exports.queueService = new QueueService({
    defaultConcurrent: 10
});
