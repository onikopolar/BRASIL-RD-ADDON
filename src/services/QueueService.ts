import pLimit from 'p-limit';
import NamedQueue from 'named-queue';
import { Logger } from '../utils/logger';

export interface QueueConfig {
  maxConcurrent: number;
  queueName: string;
  timeoutMs?: number;
}

export class QueueService {
  private logger: Logger;
  private queues: Map<string, ReturnType<typeof pLimit>>;
  private namedQueues: Map<string, NamedQueue>;
  private defaultConcurrent: number;

  constructor(config?: { defaultConcurrent?: number }) {
    this.logger = new Logger('QueueService');
    this.queues = new Map();
    this.namedQueues = new Map();
    this.defaultConcurrent = config?.defaultConcurrent || 5;
    
    this.logger.info('QueueService inicializado', {
      defaultConcurrent: this.defaultConcurrent
    });
  }

  // Fila genérica com p-limit
  getQueue(name: string, maxConcurrent?: number): ReturnType<typeof pLimit> {
    if (!this.queues.has(name)) {
      const limit = maxConcurrent || this.defaultConcurrent;
      this.queues.set(name, pLimit(limit));
      this.logger.debug('Fila criada', { name, maxConcurrent: limit });
    }
    return this.queues.get(name)!;
  }

  // Fila nomeada para operações sequenciais por chave
  getNamedQueue(name: string, maxConcurrent?: number): NamedQueue {
    if (!this.namedQueues.has(name)) {
      const limit = maxConcurrent || this.defaultConcurrent;
      const queue = new NamedQueue(limit);
      this.namedQueues.set(name, queue);
      this.logger.debug('Fila nomeada criada', { name, maxConcurrent: limit });
    }
    return this.namedQueues.get(name)!;
  }

  // Executa tarefa em fila genérica
  async executeInQueue<T>(
    queueName: string, 
    task: () => Promise<T>, 
    taskName?: string
  ): Promise<T> {
    const queue = this.getQueue(queueName);
    const startTime = Date.now();
    
    this.logger.debug('Tarefa adicionada à fila', {
      queue: queueName,
      task: taskName || 'anonima',
      pending: (queue as any).pendingCount,
      active: (queue as any).activeCount
    });

    try {
      const result = await queue(task);
      const duration = Date.now() - startTime;
      
      this.logger.debug('Tarefa concluída', {
        queue: queueName,
        task: taskName || 'anonima',
        duration: `${duration}ms`,
        pending: (queue as any).pendingCount,
        active: (queue as any).activeCount
      });

      return result;
    } catch (error) {
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

  // Executa tarefa em fila nomeada (sequencial por chave)
  async executeInNamedQueue<T>(
    queueName: string,
    key: string,
    task: () => Promise<T>,
    taskName?: string
  ): Promise<T> {
    const queue = this.getNamedQueue(queueName);
    const startTime = Date.now();

    this.logger.debug('Tarefa adicionada à fila nomeada', {
      queue: queueName,
      key,
      task: taskName || 'anonima',
      queueSize: queue.size()
    });

    return new Promise((resolve, reject) => {
      queue.push(key, async (callback: any) => {
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
        } catch (error) {
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

  // Estatísticas das filas
  getQueueStats() {
    const stats: any = {
      genericQueues: {},
      namedQueues: {},
      totals: {
        generic: this.queues.size,
        named: this.namedQueues.size
      }
    };

    // Estatísticas filas genéricas
    for (const [name, queue] of this.queues) {
      stats.genericQueues[name] = {
        pendingCount: (queue as any).pendingCount,
        activeCount: (queue as any).activeCount
      };
    }

    // Estatísticas filas nomeadas
    for (const [name, queue] of this.namedQueues) {
      stats.namedQueues[name] = {
        size: queue.size()
      };
    }

    return stats;
  }

  // Limpa todas as filas
  clearAll() {
    this.queues.clear();
    this.namedQueues.clear();
    this.logger.info('Todas as filas limpas');
  }
}

// Instância global
export const queueService = new QueueService({
  defaultConcurrent: 10
});