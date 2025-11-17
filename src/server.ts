import * as dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import path from 'path';
import { addonBuilder, getRouter, serveHTTP } from 'stremio-addon-sdk';
import { StreamHandler } from './services/StreamHandler';
import { Logger } from './utils/logger';
import { StreamRequest } from './types/index';
import configRoutes from './routes/config';

const logger = new Logger('Main');
const streamHandler = new StreamHandler();

// Verificar parâmetros de linha de comando
const args = process.argv.slice(2);
const shouldLaunch = args.includes('--launch');
const shouldInstall = args.includes('--install');

logger.info('INICIANDO SERVIDOR - Parametros de linha de comando', { 
    args, 
    shouldLaunch, 
    shouldInstall,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch
});

// Criar app Express
const app = express();

// Middleware de logging para TODAS as requisições
app.use((req, res, next) => {
    const startTime = Date.now();
    
    // Log da requisição recebida
    logger.info(`REQUISICAO RECEBIDA - ${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        query: req.query,
        headers: {
            'content-type': req.get('Content-Type'),
            'accept': req.get('Accept'),
            'origin': req.get('Origin'),
            'referer': req.get('Referer')
        },
        bodySize: req.headers['content-length'] || 'unknown'
    });

    // Interceptar a resposta para log
    const originalSend = res.send;
    res.send = function(body) {
        const duration = Date.now() - startTime;
        
        logger.info(`RESPOSTA ENVIADA - ${req.method} ${req.path}`, {
            statusCode: res.statusCode,
            duration: `${duration}ms`,
            contentLength: res.get('Content-Length'),
            contentType: res.get('Content-Type'),
            bodyType: typeof body,
            bodySample: typeof body === 'string' ? body.substring(0, 200) + '...' : 'JSON/Object'
        });
        
        return originalSend.apply(this, arguments as any);
    };

    next();
});

// Middlewares
app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

// Log específico para arquivos estáticos
app.use('/public', (req, res, next) => {
    logger.info(`ARQUIVO ESTATICO SOLICITADO - ${req.path}`, {
        method: req.method,
        ip: req.ip
    });
    next();
});

// Usar rotas de configuração
app.use(configRoutes);

// Rota principal para nossa UI personalizada
app.get('/', (req, res) => {
    logger.info('ROTA PRINCIPAL - Servindo index.html', {
        userAgent: req.get('User-Agent'),
        acceptHeader: req.get('Accept')
    });
    res.sendFile(path.join(process.cwd(), 'public/index.html'));
});

// Rota de configuração personalizada
app.get('/configure', (req, res) => {
    logger.info('ROTA CONFIGURE - Servindo index.html', {
        userAgent: req.get('User-Agent')
    });
    res.sendFile(path.join(process.cwd(), 'public/index.html'));
});

// Rota do manifesto com suporte a parâmetros Torrentio-style
app.get('/manifest.json', (req, res) => {
    const apiKey = req.query.apiKey as string;
    
    logger.info('MANIFESTO ACESSADO - Detalhes da requisição', {
        hasApiKey: !!apiKey,
        apiKeyLength: apiKey ? apiKey.length : 0,
        apiKeySample: apiKey ? `${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}` : 'none',
        userAgent: req.get('User-Agent'),
        acceptHeader: req.get('Accept'),
        origin: req.get('Origin'),
        referer: req.get('Referer'),
        queryParams: req.query,
        headers: req.headers
    });

    // Log completo dos headers para debug
    console.log('HEADERS COMPLETOS DA REQUISICAO MANIFEST:');
    Object.keys(req.headers).forEach(key => {
        console.log(`  ${key}: ${req.headers[key]}`);
    });

    const manifest = {
        id: 'com.brasil-rd',
        version: '1.0.0',
        name: apiKey ? 'Brasil RD (Configurado)' : 'Brasil RD',
        description: 'Addon profissional brasileiro com Real-Debrid e magnet links curados',
        logo: 'https://raw.githubusercontent.com/Stremio/stremio-art/main/placeholder/icon-256.png',
        resources: ['stream'],
        types: ['movie', 'series'],
        catalogs: [],
        idPrefixes: ['tt'],
        behaviorHints: {
            configurable: true,
            configurationRequired: !apiKey
        },
        config: [
            {
                key: 'apiKey',
                type: 'text',
                title: 'Chave API do Real-Debrid',
                required: 'true'
            }
        ]
    };

    logger.info('MANIFESTO GERADO - Estrutura do manifest', {
        manifestId: manifest.id,
        manifestName: manifest.name,
        resources: manifest.resources,
        types: manifest.types,
        behaviorHints: manifest.behaviorHints
    });

    // Forçar headers específicos para evitar confusão com mídia
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    
    res.json(manifest);
});

// Rota para gerar URL personalizada Torrentio-style
app.get('/generate-url', (req, res) => {
    const { apiKey } = req.query;
    
    logger.info('GENERATE-URL ACESSADO - Gerando URL personalizada', { 
        hasApiKey: !!apiKey,
        apiKeyLength: apiKey ? (apiKey as string).length : 0
    });

    if (!apiKey) {
        logger.warn('GENERATE-URL ERRO - API key não fornecida');
        return res.status(400).json({ error: 'API key é obrigatória' });
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const personalizedUrl = `${baseUrl}/manifest.json?apiKey=${encodeURIComponent(apiKey as string)}`;
    
    logger.info('GENERATE-URL SUCESSO - URL personalizada gerada', {
        baseUrl,
        personalizedUrl,
        apiKeyLength: (apiKey as string).length
    });

    res.json({
        success: true,
        url: personalizedUrl,
        installUrl: personalizedUrl,
        message: 'Use esta URL para instalar o addon já configurado'
    });
});

// Builder do Addon Stremio
logger.info('CRIANDO ADDON BUILDER - Iniciando construção do addon');
const builder = new addonBuilder({
    id: 'com.brasil-rd',
    version: '1.0.0',
    name: 'Brasil RD',
    description: 'Addon profissional brasileiro com Real-Debrid e magnet links curados',
    logo: 'https://raw.githubusercontent.com/Stremio/stremio-art/main/placeholder/icon-256.png',
    resources: ['stream'],
    types: ['movie', 'series'],
    catalogs: [],
    idPrefixes: ['tt'],
    behaviorHints: {
        configurable: true,
        configurationRequired: true
    },
    config: [
        {
            key: 'apiKey',
            type: 'text',
            title: 'Chave API do Real-Debrid',
            required: 'true'
        }
    ]
});

logger.info('ADDON BUILDER CRIADO - Builder configurado com sucesso', {
    id: 'com.brasil-rd',
    name: 'Brasil RD',
    resources: ['stream'],
    types: ['movie', 'series']
});

// Handler de streams - atualizado para usar API key da URL se disponível
builder.defineStreamHandler(async (args: any): Promise<{ streams: any[] }> => {
    // Tentar obter API key da URL primeiro, depois da configuração do Stremio
    let apiKey = args.config?.apiKey;
    
    // Se não tem API key na config, verificar se veio via URL
    if (!apiKey && args.extra && args.extra.addonUrl) {
        const urlParams = new URLSearchParams(args.extra.addonUrl.split('?')[1]);
        apiKey = urlParams.get('apiKey');
    }

    const request: StreamRequest = {
        type: args.type,
        id: args.id,
        title: args.name || args.title,
        apiKey: apiKey
    };

    logger.info('STREAM HANDLER - Recebida requisição de stream', {
        type: args.type,
        id: args.id,
        hasApiKey: !!apiKey,
        source: apiKey ? (args.config?.apiKey ? 'stremio-config' : 'url-param') : 'none',
        addonUrl: args.extra?.addonUrl,
        args: JSON.stringify(args)
    });

    try {
        if (!apiKey) {
            logger.warn('STREAM HANDLER - Stream request sem API key, retornando streams vazios');
            return { streams: [] };
        }

        logger.info('STREAM HANDLER - Processando request com StreamHandler', {
            requestId: request.id,
            requestType: request.type,
            requestTitle: request.title
        });

        const result = await streamHandler.handleStreamRequest(request);
        
        logger.info('STREAM HANDLER - Stream response preparada com sucesso', {
            requestId: request.id,
            streamsCount: result.streams.length,
            streamsSample: result.streams.slice(0, 3).map(s => ({ title: s.title, url: s.url }))
        });
        
        return result;
    } catch (error) {
        logger.error('STREAM HANDLER - Erro no stream handler', {
            error: error instanceof Error ? error.message : 'Unknown error',
            errorStack: error instanceof Error ? error.stack : 'No stack',
            request: { type: request.type, id: request.id }
        });
        return { streams: [] };
    }
});

// Obter a interface do addon
logger.info('OBTENDO INTERFACE DO ADDON - Criando interface a partir do builder');
const addonInterface = builder.getInterface();
logger.info('INTERFACE DO ADDON OBTIDA - Interface criada com sucesso', {
    interfaceType: typeof addonInterface,
    manifest: addonInterface.manifest
});

// Rota catch-all para SPA - deve vir ANTES do addonRouter
app.get('*', (req, res, next) => {
    // Se não for uma rota de API ou arquivo, servir o index.html
    if (!req.path.startsWith('/api/') && !req.path.includes('.')) {
        logger.info('CATCH-ALL ROUTE - Servindo index.html para rota SPA', {
            path: req.path,
            userAgent: req.get('User-Agent')
        });
        return res.sendFile(path.join(process.cwd(), 'public/index.html'));
    }
    
    logger.info('CATCH-ALL ROUTE - Passando para proximo middleware', {
        path: req.path
    });
    next();
});

// Inicialização do servidor
async function main(): Promise<void> {
    const port = parseInt(process.env.PORT || '7000');

    try {
        logger.info('MAIN - Iniciando Brasil RD Addon', { 
            port,
            shouldLaunch,
            shouldInstall,
            nodeEnv: process.env.NODE_ENV || 'development',
            currentDirectory: process.cwd(),
            publicDirectory: path.join(process.cwd(), 'public'),
            distDirectory: path.join(process.cwd(), 'dist')
        });

        // Verificar se diretórios existem
        const fs = require('fs');
        const publicExists = fs.existsSync(path.join(process.cwd(), 'public'));
        const distExists = fs.existsSync(path.join(process.cwd(), 'dist'));
        
        logger.info('MAIN - Verificacao de diretorios', {
            publicExists,
            distExists,
            publicFiles: publicExists ? fs.readdirSync(path.join(process.cwd(), 'public')) : 'N/A',
            distFiles: distExists ? fs.readdirSync(path.join(process.cwd(), 'dist')) : 'N/A'
        });

        // Usar serveHTTP do SDK oficial quando os parâmetros estiverem presentes
        if (shouldLaunch || shouldInstall) {
            logger.info('MAIN - Usando serveHTTP do SDK oficial');
            await serveHTTP(addonInterface, { port: port });
        } else {
            // Modo normal com Express + SDK router
            logger.info('MAIN - Usando Express + SDK router');
            const addonRouter = getRouter(addonInterface);
            app.use(addonRouter);
            
            app.listen(port, '0.0.0.0', () => {
                logger.info('MAIN - Servidor Express iniciado com sucesso', {
                    port,
                    uiUrl: `http://0.0.0.0:${port}`,
                    manifestUrl: `http://0.0.0.0:${port}/manifest.json`,
                    exampleUrl: `http://0.0.0.0:${port}/manifest.json?apiKey=SUA_CHAVE_AQUI`,
                    configUrl: `http://0.0.0.0:${port}/`,
                    networkUrl: `http://localhost:${port}`
                });
                
                console.log('=========================================');
                console.log('SERVIDOR INICIADO COM SUCESSO!');
                console.log(`Porta: ${port}`);
                console.log(`UI: http://localhost:${port}`);
                console.log(`Configure: http://localhost:${port}/configure`);
                console.log(`Manifest: http://localhost:${port}/manifest.json`);
                console.log(`Exemplo com API Key: http://localhost:${port}/manifest.json?apiKey=SUA_CHAVE_AQUI`);
                console.log('=========================================');
            });
        }

    } catch (error: any) {
        logger.error('MAIN - Falha crítica ao iniciar servidor', {
            error: error.message,
            code: error.code,
            stack: error.stack,
            port: process.env.PORT || '7000'
        });
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', () => {
    logger.info('SHUTDOWN - Encerrando Brasil RD Addon (SIGINT)');
    process.exit(0);
});

process.on('SIGTERM', () => {
    logger.info('SHUTDOWN - Encerrando Brasil RD Addon (SIGTERM)');
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    logger.error('UNCAUGHT EXCEPTION - Erro não tratado', {
        error: error.message,
        stack: error.stack
    });
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('UNHANDLED REJECTION - Promise rejeitada não tratada', {
        reason: reason instanceof Error ? reason.message : reason,
        promise: promise.toString()
    });
    process.exit(1);
});

// Iniciar aplicação
if (require.main === module) {
    logger.info('INIT - Iniciando aplicação como modulo principal');
    main().catch(error => {
        logger.error('INIT - Erro fatal durante a inicializacao', {
            error: error.message,
            stack: error.stack
        });
        process.exit(1);
    });
}

logger.info('EXPORT - Exportando interface do addon');
export default builder.getInterface();