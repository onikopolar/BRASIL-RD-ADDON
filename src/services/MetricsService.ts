import client from 'prom-client';
import { Request, Response } from 'express';
import { Logger } from '../utils/logger.js';

export class MetricsService {
  private logger: Logger;
  private register: client.Registry;
  private isInitialized: boolean;

  // Métricas HTTP
  private httpRequestDuration!: client.Histogram<string>;
  private httpRequestTotal!: client.Counter<string>;
  private httpRequestErrors!: client.Counter<string>;

  // Métricas de cache
  private cacheHits!: client.Counter<string>;
  private cacheMisses!: client.Counter<string>;
  private cacheSize!: client.Gauge<string>;

  // Métricas de fila
  private queuePending!: client.Gauge<string>;
  private queueActive!: client.Gauge<string>;
  private queueCompleted!: client.Counter<string>;

  // Métricas de streams
  private streamsReturned!: client.Counter<string>;
  private streamsByQuality!: client.Counter<string>;
  private streamsByType!: client.Counter<string>;

  // Métricas de clientes
  private clientsByBrowser!: client.Counter<string>;
  private clientsByOS!: client.Counter<string>;
  private clientsByDevice!: client.Counter<string>;

  constructor() {
    this.logger = new Logger('MetricsService');
    this.register = new client.Registry();
    this.isInitialized = false;

    // Configurações padrão
    client.collectDefaultMetrics({ register: this.register });

    // Inicializa métricas
    this.initializeMetrics();
  }

  private initializeMetrics() {
    try {
      // Métricas HTTP
      this.httpRequestDuration = new client.Histogram({
        name: 'http_request_duration_seconds',
        help: 'Duração das requisições HTTP em segundos',
        labelNames: ['method', 'route', 'status_code'] as const,
        buckets: [0.1, 0.5, 1, 2, 5, 10]
      });

      this.httpRequestTotal = new client.Counter({
        name: 'http_requests_total',
        help: 'Total de requisições HTTP',
        labelNames: ['method', 'route', 'status_code'] as const
      });

      this.httpRequestErrors = new client.Counter({
        name: 'http_request_errors_total',
        help: 'Total de erros HTTP',
        labelNames: ['method', 'route', 'error_type'] as const
      });

      // Métricas de cache
      this.cacheHits = new client.Counter({
        name: 'cache_hits_total',
        help: 'Total de hits no cache'
      });

      this.cacheMisses = new client.Counter({
        name: 'cache_misses_total',
        help: 'Total de misses no cache'
      });

      this.cacheSize = new client.Gauge({
        name: 'cache_size',
        help: 'Tamanho atual do cache'
      });

      // Métricas de fila
      this.queuePending = new client.Gauge({
        name: 'queue_pending_tasks',
        help: 'Tarefas pendentes na fila',
        labelNames: ['queue_name'] as const
      });

      this.queueActive = new client.Gauge({
        name: 'queue_active_tasks',
        help: 'Tarefas ativas na fila',
        labelNames: ['queue_name'] as const
      });

      this.queueCompleted = new client.Counter({
        name: 'queue_completed_tasks_total',
        help: 'Total de tarefas completadas',
        labelNames: ['queue_name'] as const
      });

      // Métricas de streams
      this.streamsReturned = new client.Counter({
        name: 'streams_returned_total',
        help: 'Total de streams retornados',
        labelNames: ['type', 'quality'] as const
      });

      this.streamsByQuality = new client.Counter({
        name: 'streams_by_quality_total',
        help: 'Streams por qualidade',
        labelNames: ['quality'] as const
      });

      this.streamsByType = new client.Counter({
        name: 'streams_by_type_total',
        help: 'Streams por tipo',
        labelNames: ['type'] as const
      });

      // Métricas de clientes
      this.clientsByBrowser = new client.Counter({
        name: 'clients_by_browser_total',
        help: 'Clientes por navegador',
        labelNames: ['browser'] as const
      });

      this.clientsByOS = new client.Counter({
        name: 'clients_by_os_total',
        help: 'Clientes por sistema operacional',
        labelNames: ['os'] as const
      });

      this.clientsByDevice = new client.Counter({
        name: 'clients_by_device_total',
        help: 'Clientes por dispositivo',
        labelNames: ['device'] as const
      });

      // Registra todas as métricas
      this.register.registerMetric(this.httpRequestDuration);
      this.register.registerMetric(this.httpRequestTotal);
      this.register.registerMetric(this.httpRequestErrors);
      this.register.registerMetric(this.cacheHits);
      this.register.registerMetric(this.cacheMisses);
      this.register.registerMetric(this.cacheSize);
      this.register.registerMetric(this.queuePending);
      this.register.registerMetric(this.queueActive);
      this.register.registerMetric(this.queueCompleted);
      this.register.registerMetric(this.streamsReturned);
      this.register.registerMetric(this.streamsByQuality);
      this.register.registerMetric(this.streamsByType);
      this.register.registerMetric(this.clientsByBrowser);
      this.register.registerMetric(this.clientsByOS);
      this.register.registerMetric(this.clientsByDevice);

      this.isInitialized = true;
      this.logger.debug('MetricsService ready');

    } catch (error) {
      this.logger.error('Erro ao inicializar métricas', {
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
    }
  }

  // Middleware para métricas HTTP
  httpMetricsMiddleware() {
    return (req: Request, res: Response, next: Function) => {
      const startTime = Date.now();
      const route = req.route?.path || req.path;

      // Incrementa contador de clientes se tiver clientInfo
      if ((req as any).clientInfo) {
        const clientInfo = (req as any).clientInfo;
        this.clientsByBrowser.inc({ browser: clientInfo.browser || 'unknown' });
        this.clientsByOS.inc({ os: clientInfo.os || 'unknown' });
        this.clientsByDevice.inc({ device: clientInfo.deviceType || 'unknown' });
      }

      res.on('finish', () => {
        const duration = (Date.now() - startTime) / 1000;
        const statusCode = res.statusCode.toString();

        this.httpRequestDuration.observe({ method: req.method, route, status_code: statusCode }, duration);
        this.httpRequestTotal.inc({ method: req.method, route, status_code: statusCode });

        if (statusCode.startsWith('4') || statusCode.startsWith('5')) {
          this.httpRequestErrors.inc({ 
            method: req.method, 
            route, 
            error_type: statusCode.startsWith('4') ? 'client_error' : 'server_error' 
          });
        }
      });

      next();
    };
  }

  // Métricas de cache
  recordCacheHit() {
    this.cacheHits.inc();
  }

  recordCacheMiss() {
    this.cacheMisses.inc();
  }

  setCacheSize(size: number) {
    this.cacheSize.set(size);
  }

  // Métricas de fila
  updateQueueMetrics(queueName: string, pending: number, active: number) {
    this.queuePending.set({ queue_name: queueName }, pending);
    this.queueActive.set({ queue_name: queueName }, active);
  }

  recordQueueCompletion(queueName: string) {
    this.queueCompleted.inc({ queue_name: queueName });
  }

  // Métricas de streams
  recordStreamReturned(type: string, quality: string, count: number = 1) {
    this.streamsReturned.inc({ type, quality }, count);
    this.streamsByQuality.inc({ quality }, count);
    this.streamsByType.inc({ type }, count);
  }

  // Rota para exportar métricas
  metricsRoute() {
    return async (req: Request, res: Response) => {
      try {
        res.set('Content-Type', this.register.contentType);
        const metrics = await this.register.metrics();
        res.end(metrics);
      } catch (error) {
        this.logger.error('Erro ao coletar métricas', {
          error: error instanceof Error ? error.message : 'Erro desconhecido'
        });
        res.status(500).json({ error: 'Erro ao coletar métricas' });
      }
    };
  }

  // Coletar estatísticas atuais (versão simplificada)
  getMetricsSnapshot() {
    return {
      http: {
        requestDuration: 'Disponível em /metrics',
        requestTotal: 'Disponível em /metrics',
        requestErrors: 'Disponível em /metrics'
      },
      cache: {
        hits: this.cacheHits ? 'Disponível em /metrics' : 'Não inicializado',
        misses: this.cacheMisses ? 'Disponível em /metrics' : 'Não inicializado',
        size: this.cacheSize ? 'Disponível em /metrics' : 'Não inicializado'
      },
      streams: {
        returned: this.streamsReturned ? 'Disponível em /metrics' : 'Não inicializado',
        byQuality: this.streamsByQuality ? 'Disponível em /metrics' : 'Não inicializado',
        byType: this.streamsByType ? 'Disponível em /metrics' : 'Não inicializado'
      }
    };
  }

  // Verifica se está inicializado
  isReady(): boolean {
    return this.isInitialized;
  }
}

// Instância global
export const metricsService = new MetricsService();