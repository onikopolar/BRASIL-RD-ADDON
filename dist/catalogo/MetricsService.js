"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.metricsService = exports.MetricsService = void 0;
const prom_client_1 = __importDefault(require("prom-client"));
const logger_js_1 = require("../utils/logger.js");
class MetricsService {
    constructor() {
        this.logger = new logger_js_1.Logger('MetricsService');
        this.register = new prom_client_1.default.Registry();
        this.isInitialized = false;
        prom_client_1.default.collectDefaultMetrics({ register: this.register });
        this.initializeMetrics();
    }
    initializeMetrics() {
        try {
            this.httpRequestDuration = new prom_client_1.default.Histogram({
                name: 'http_request_duration_seconds',
                help: 'Duração das requisições HTTP em segundos',
                labelNames: ['method', 'route', 'status_code'],
                buckets: [0.1, 0.5, 1, 2, 5, 10]
            });
            this.httpRequestTotal = new prom_client_1.default.Counter({
                name: 'http_requests_total',
                help: 'Total de requisições HTTP',
                labelNames: ['method', 'route', 'status_code']
            });
            this.httpRequestErrors = new prom_client_1.default.Counter({
                name: 'http_request_errors_total',
                help: 'Total de erros HTTP',
                labelNames: ['method', 'route', 'error_type']
            });
            this.cacheHits = new prom_client_1.default.Counter({
                name: 'cache_hits_total',
                help: 'Total de hits no cache'
            });
            this.cacheMisses = new prom_client_1.default.Counter({
                name: 'cache_misses_total',
                help: 'Total de misses no cache'
            });
            this.cacheSize = new prom_client_1.default.Gauge({
                name: 'cache_size',
                help: 'Tamanho atual do cache'
            });
            this.queuePending = new prom_client_1.default.Gauge({
                name: 'queue_pending_tasks',
                help: 'Tarefas pendentes na fila',
                labelNames: ['queue_name']
            });
            this.queueActive = new prom_client_1.default.Gauge({
                name: 'queue_active_tasks',
                help: 'Tarefas ativas na fila',
                labelNames: ['queue_name']
            });
            this.queueCompleted = new prom_client_1.default.Counter({
                name: 'queue_completed_tasks_total',
                help: 'Total de tarefas completadas',
                labelNames: ['queue_name']
            });
            this.streamsReturned = new prom_client_1.default.Counter({
                name: 'streams_returned_total',
                help: 'Total de streams retornados',
                labelNames: ['type', 'quality']
            });
            this.streamsByQuality = new prom_client_1.default.Counter({
                name: 'streams_by_quality_total',
                help: 'Streams por qualidade',
                labelNames: ['quality']
            });
            this.streamsByType = new prom_client_1.default.Counter({
                name: 'streams_by_type_total',
                help: 'Streams por tipo',
                labelNames: ['type']
            });
            this.clientsByBrowser = new prom_client_1.default.Counter({
                name: 'clients_by_browser_total',
                help: 'Clientes por navegador',
                labelNames: ['browser']
            });
            this.clientsByOS = new prom_client_1.default.Counter({
                name: 'clients_by_os_total',
                help: 'Clientes por sistema operacional',
                labelNames: ['os']
            });
            this.clientsByDevice = new prom_client_1.default.Counter({
                name: 'clients_by_device_total',
                help: 'Clientes por dispositivo',
                labelNames: ['device']
            });
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
        }
        catch (error) {
            this.logger.error('Erro ao inicializar métricas', {
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
        }
    }
    httpMetricsMiddleware() {
        return (req, res, next) => {
            const startTime = Date.now();
            const route = req.route?.path || req.path;
            if (req.clientInfo) {
                const clientInfo = req.clientInfo;
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
    recordCacheHit() {
        this.cacheHits.inc();
    }
    recordCacheMiss() {
        this.cacheMisses.inc();
    }
    setCacheSize(size) {
        this.cacheSize.set(size);
    }
    updateQueueMetrics(queueName, pending, active) {
        this.queuePending.set({ queue_name: queueName }, pending);
        this.queueActive.set({ queue_name: queueName }, active);
    }
    recordQueueCompletion(queueName) {
        this.queueCompleted.inc({ queue_name: queueName });
    }
    recordStreamReturned(type, quality, count = 1) {
        this.streamsReturned.inc({ type, quality }, count);
        this.streamsByQuality.inc({ quality }, count);
        this.streamsByType.inc({ type }, count);
    }
    metricsRoute() {
        return async (req, res) => {
            try {
                res.set('Content-Type', this.register.contentType);
                const metrics = await this.register.metrics();
                res.end(metrics);
            }
            catch (error) {
                this.logger.error('Erro ao coletar métricas', {
                    error: error instanceof Error ? error.message : 'Erro desconhecido'
                });
                res.status(500).json({ error: 'Erro ao coletar métricas' });
            }
        };
    }
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
    isReady() {
        return this.isInitialized;
    }
}
exports.MetricsService = MetricsService;
exports.metricsService = new MetricsService();
