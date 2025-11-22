import { addonBuilder, getRouter } from 'stremio-addon-sdk';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import https from 'https';
import { StreamHandler } from './services/StreamHandler';
import { RealDebridService } from './services/RealDebridService';
import { AutoMagnetService } from './services/AutoMagnetService';
import { CacheService } from './services/CacheService';
import { Logger } from './utils/logger';
import { StreamRequest } from './types';

const logger = new Logger('Main');
const streamHandler = new StreamHandler();
const autoMagnetService = new AutoMagnetService();
const cacheService = new CacheService();
const app = express();

// Cache para links já resolvidos usando CacheService
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 horas

// Configuração do Express
app.use(cors());
app.use(express.json());

// Manifest do addon
const manifest = {
    id: 'org.brasilrd.addon',
    version: '1.0.0',
    name: 'Brasil RD',
    description: 'Addon brasileiro com suporte completo ao Real-Debrid',

    logo: 'https://raw.githubusercontent.com/Stremio/stremio-art/main/placeholder/icon-256.png',
    background: 'https://raw.githubusercontent.com/Stremio/stremio-art/main/placeholder/background-1920x1080.jpg',
    contactEmail: '',

    resources: ['stream'],
    types: ['movie', 'series'],
    catalogs: [],
    idPrefixes: ['tt', 'tmdb', 'tvdb', 'imdb'],

    behaviorHints: {
        configurable: true,
        configurationRequired: true,
        adult: false,
        p2p: false
    },

    config: [
        {
            key: 'apiKey',
            type: 'text',
            title: 'Chave de API do Real-Debrid',
            required: true,
            placeholder: 'Cole sua chave de API aqui'
        }
    ]
};

const builder = new addonBuilder(manifest as any);

// Handler principal de streams
builder.defineStreamHandler(async (args: any) => {
    const requestStartTime = Date.now();

    const config = args.config;

    if (!config || !config.apiKey) {
        logger.warn('Requisição de stream sem API key configurada', {
            type: args.type,
            id: args.id
        });
        return { streams: [] };
    }

    const streamRequest: StreamRequest = {
        type: args.type as 'movie' | 'series',
        id: args.id,
        title: '',
        apiKey: config.apiKey,
        config: {
            quality: 'Todas as Qualidades',
            maxResults: '15 streams',
            language: 'pt-BR',
            enableAggressiveSearch: true,
            minSeeders: 2,
            requireExactMatch: false,
            maxConcurrentTorrents: 8
        }
    };

    logger.info('Processando requisição de stream', {
        type: args.type,
        id: args.id,
        apiKey: config.apiKey.substring(0, 8) + '...'
    });

    try {
        const result = await streamHandler.handleStreamRequest(streamRequest);
        const processingTime = Date.now() - requestStartTime;

        logger.info('Streams processados com sucesso', {
            requestId: args.id,
            streamsCount: result.streams.length,
            processingTime: processingTime + 'ms',
        });

        if (result.streams.length > 0) {
            logger.debug('Nomes dos streams encontrados', {
                streamNames: result.streams.map(s => s.name)
            });
        }

        if (result.streams.length < 5) {
            logger.warn('Poucos streams encontrados', {
                requestId: args.id,
                streamsFound: result.streams.length,
                type: args.type,
                id: args.id
            });
        }

        logger.info("DEBUG - Streams sendo retornados para o cliente:", { 
            requestId: args.id, 
            streamCount: result.streams.length, 
            streamTitles: result.streams.map(s => s.title), 
            streamSources: result.streams.map(s => s.sources), // ← MUDOU AQUI
            streamNames: result.streams.map(s => s.name) 
        });
        return result;

    } catch (error) {
        const errorTime = Date.now() - requestStartTime;

        logger.error('Falha no processamento de streams', {
            error: error instanceof Error ? error.message : 'Unknown error',
            request: { type: args.type, id: args.id },
            processingTime: errorTime + 'ms'
        });

        return { streams: [] };
    }
});

// Obter o router do SDK Stremio
const stremioRouter = getRouter(builder.getInterface());

// Configuração de cache
const cacheMaxAge = 600;
app.use((req: any, res: any, next: any) => {
    if (cacheMaxAge && !res.getHeader('Cache-Control')) {
        res.setHeader('Cache-Control', 'max-age=' + cacheMaxAge + ', public');
    }
    next();
});

// Página de configuração personalizada com design limpo
app.get('/configure', (req: any, res: any) => {
    const background = manifest.background || 'https://dl.strem.io/addon-background.jpg'
    const logo = manifest.logo || 'https://dl.strem.io/addon-logo.png'
    
    const landingHTML = `
        <!DOCTYPE html>
        <html style="background-image: url(${background});">
        <head>
            <meta charset="utf-8">
            <title>${manifest.name} - Stremio Addon</title>
            <style>
                * {
                    box-sizing: border-box;
                }

                body,
                html {
                    margin: 0;
                    padding: 0;
                    width: 100%;
                    min-height: 100%;
                }

                body {
                    padding: 2vh;
                    font-size: 2.2vh;
                }

                html {
                    background-size: auto 100%;
                    background-size: cover;
                    background-position: center center;
                    background-repeat: no-repeat;
                    box-shadow: inset 0 0 0 2000px rgb(0 0 0 / 60%);
                }

                body {
                    display: flex;
                    font-family: 'Open Sans', Arial, sans-serif;
                    color: white;
                }

                h1 {
                    font-size: 4.5vh;
                    font-weight: 700;
                }

                h2 {
                    font-size: 2.2vh;
                    font-weight: normal;
                    font-style: italic;
                    opacity: 0.8;
                }

                h3 {
                    font-size: 2.2vh;
                }

                h1,
                h2,
                h3,
                p {
                    margin: 0;
                    text-shadow: 0 0 1vh rgba(0, 0, 0, 0.15);
                }

                p {
                    font-size: 1.75vh;
                }

                ul {
                    font-size: 1.75vh;
                    margin: 0;
                    margin-top: 1vh;
                    padding-left: 3vh;
                }

                a {
                    color: white
                }

                a.install-link {
                    text-decoration: none
                }

                a.api-link {
                    color: #34c5dbff;
                    text-decoration: none;
                    font-weight: 600;
                }

                a.info-link {
                    color: #34c5dbff;
                    text-decoration: none;
                    font-weight: 600;
                }

                a.api-link:hover,
                a.info-link:hover {
                    text-decoration: underline;
                }

                button {
                    border: 0;
                    outline: 0;
                    color: white;
                    background: #8A5AAB;
                    padding: 1.2vh 3.5vh;
                    margin: auto;
                    text-align: center;
                    font-family: 'Open Sans', Arial, sans-serif;
                    font-size: 2.2vh;
                    font-weight: 600;
                    cursor: pointer;
                    display: block;
                    box-shadow: 0 0.5vh 1vh rgba(0, 0, 0, 0.2);
                    transition: box-shadow 0.1s ease-in-out;
                }

                button:hover {
                    box-shadow: none;
                }

                button:active {
                    box-shadow: 0 0 0 0.5vh white inset;
                }

                #addon {
                    width: 40vh;
                    margin: auto;
                }

                .logo {
                    height: 14vh;
                    width: 14vh;
                    margin: auto;
                    margin-bottom: 3vh;
                }

                .logo img {
                    width: 100%;
                }

                .name, .version {
                    display: inline-block;
                    vertical-align: top;
                }

                .name {
                    line-height: 5vh;
                    margin: 0;
                }

                .version {
                    position: relative;
                    line-height: 5vh;
                    opacity: 0.8;
                    margin-bottom: 2vh;
                }

                .contact {
                    position: absolute;
                    left: 0;
                    bottom: 4vh;
                    width: 100%;
                    text-align: center;
                }

                .contact a {
                    font-size: 1.4vh;
                    font-style: italic;
                }

                .separator {
                    margin-bottom: 4vh;
                }

                .form-element {
                    margin-bottom: 2vh;
                }

                .label-to-top {
                    margin-bottom: 2vh;
                }

                .label-to-right {
                    margin-left: 1vh !important;
                }

                .full-width {
                    width: 100%;
                }

                input[type="text"] {
                    width: 100%;
                    padding: 8px;
                    border: 1px solid #ccc;
                    border-radius: 3px;
                    font-size: 14px;
                }

                .info-text {
                    font-size: 1.8vh;
                    color: #ecf0f1;
                    margin-top: 1.5vh;
                    line-height: 1.4;
                    text-shadow: 0 0 1vh rgba(0, 0, 0, 0.3);
                }

                .warning-text {
                    font-size: 1.7vh;
                    color: #fff428ff;
                    margin-top: 2vh;
                    padding: 1.5vh;
                    background: rgba(243, 156, 18, 0.15);
                    border-radius: 5px;
                    border-left: 4px solid #f39c12;
                    line-height: 1.5;
                    text-shadow: 0 0 1vh rgba(0, 0, 0, 0.3);
                }

                .warning-text strong {
                    color: #fce729ff;
                }
            </style>
            <link href="https://fonts.googleapis.com/css?family=Open+Sans:400,600,700&display=swap" rel="stylesheet">
        </head>
        <body>
            <div id="addon">
                <div class="logo">
                    <img src="${logo}">
                </div>
                <h1 class="name">${manifest.name}</h1>
                <h2 class="version">v${manifest.version}</h2>
                <h2 class="description">${manifest.description}</h2>

                <div class="separator"></div>

                <h3 class="gives">Este addon oferece: :</h3>
                <ul>
                    <li>Filmes</li>
                    <li>Séries</li>
                </ul>

                <div class="separator"></div>

                <form class="pure-form" id="mainForm">
                    <div class="form-element">
                        <div class="label-to-top">Chave de API do Real-Debrid (Obtenha sua <a href="https://real-debrid.com/apitoken" target="_blank" class="api-link">API aqui</a>)</div>
                        <input type="text" id="${manifest.config[0].key}" name="${manifest.config[0].key}" class="full-width" required placeholder="${manifest.config[0].placeholder}"/>
                        
                        <div class="info-text">
                            Documentação completa do addon disponível <a href="https://github.com/onikopolar/BRASIL-RD-ADDON" target="_blank" class="info-link">aqui</a>
                        </div>

                        <div class="warning-text">
                            <strong>Aviso de Segurança:</strong> Este é o repositório oficial mantido por ONIKO. Não me responsabilizo pela segurança de sua chave API em forks ou versões não oficiais deste projeto.
                        </div>
                    </div>
                </form>

                <div class="separator"></div>

                <a id="installLink" class="install-link" href="#">
                    <button name="Install">INSTALL</button>
                </a>
            </div>
            <script>
                installLink.onclick = () => {
                    return mainForm.reportValidity()
                }
                const updateLink = () => {
                    const config = Object.fromEntries(new FormData(mainForm))
                    installLink.href = 'stremio://' + window.location.host + '/' + encodeURIComponent(JSON.stringify(config)) + '/manifest.json'
                }
                mainForm.onchange = updateLink
                updateLink()
            </script>
        </body>
        </html>
    `;
    
    res.setHeader('content-type', 'text/html');
    res.end(landingHTML);
});

// Usar o router do SDK para todas as rotas Stremio
app.use(stremioRouter);

// Rotas customizadas

// Health check
app.get('/health', (req: any, res: any) => {
    res.json({ 
        status: 'ok', 
        service: 'Brasil RD Addon', 
        mode: 'torrentio-like-dev',
        version: manifest.version,
        features: {
            cache: true,
            lazyStreams: true,
            realDebrid: true,
            optimizations: true
        }
    });
});

// Rota de resolução sob demanda - INTELIGENTE
app.get('/resolve/:magnet', async (req: any, res: any) => {
    const encodedMagnet = req.params.magnet;
    const apiKey = req.query.apiKey as string;

    const cacheKey = `resolve:${encodedMagnet}:${apiKey}`;
        
    const cachedDirectLink = cacheService.get<string>(cacheKey);
    
    if (cachedDirectLink) {
        logger.info('Cache HIT para magnet resolvido', {
            cacheKey,
            directLink: cachedDirectLink.substring(0, 100) + '...'
        });
        return res.redirect(302, cachedDirectLink);
    }

    try {
        const magnet = Buffer.from(encodedMagnet, 'base64').toString();
        
        logger.info('Iniciando resolução inteligente de magnet', {
            magnet: magnet.substring(0, 100) + '...',
            apiKey: apiKey ? apiKey.substring(0, 8) + '...' : 'none'
        });

        if (!apiKey) {
            return res.status(400).json({
                success: false,
                error: 'API key do Real-Debrid é obrigatória'
            });
        }

        // Cria dados do magnet para o AutoMagnetService
        const magnetData = {
            imdbId: 'resolve-' + Date.now(),
            title: 'Stream sob demanda',
            magnet: magnet,
            quality: '1080p',
            seeds: 50,
            category: 'filme',
            language: 'pt-BR',
            addedAt: new Date().toISOString()
        };

        // PERGUNTA AO REAL-DEBRID: "Você tem este magnet?"
        const rdResult = await autoMagnetService.processRealDebridOnClick(magnetData, apiKey);

        if (!rdResult.success) {
            throw new Error(rdResult.message || 'Falha ao processar com Real-Debrid');
        }

        // RESPOSTA INTELIGENTE BASEADA NO STATUS
        if (rdResult.status === 'ready' && rdResult.streamLink) {
            // JÁ ESTÁ BAIXADO - Stream instantâneo
            logger.info('Stream instantâneo - conteúdo já disponível no Real-Debrid', {
                streamLink: rdResult.streamLink.substring(0, 100) + '...'
            });

            cacheService.set(cacheKey, rdResult.streamLink, CACHE_TTL);
            return res.redirect(302, rdResult.streamLink);

        } else if (rdResult.status === 'downloading' || rdResult.status === 'queued' || rdResult.status === 'magnet_conversion') {
            // ⏳ ESTÁ BAIXANDO - Retorna status informativo
            logger.info('Conteúdo em processamento no Real-Debrid', {
                status: rdResult.status,
                message: rdResult.message
            });

            return res.json({
                success: true,
                status: rdResult.status,
                message: rdResult.message || 'Conteúdo está sendo preparado...',
                action: 'refresh',
                estimatedTime: '2-5 minutos'
            });

        } else {
            // ❌ STATUS NÃO RECONHECIDO
            throw new Error(`Status do Real-Debrid não suportado: ${rdResult.status}`);
        }

    } catch (error) {
        logger.error('Erro na resolução inteligente de magnet', {
            error: error instanceof Error ? error.message : 'Unknown error',
            encodedMagnet: encodedMagnet.substring(0, 50) + '...'
        });
        
        res.status(500).json({
            success: false,
            error: 'Falha ao resolver o stream: ' + (error instanceof Error ? error.message : 'Unknown error'),
            action: 'retry'
        });
    }
});

// Rota para verificar status de um magnet específico
app.get('/resolve/:magnet/status', async (req: any, res: any) => {
    const encodedMagnet = req.params.magnet;
    const apiKey = req.query.apiKey as string;

    try {
        const magnet = Buffer.from(encodedMagnet, 'base64').toString();
        
        if (!apiKey) {
            return res.status(400).json({
                success: false,
                error: 'API key do Real-Debrid é obrigatória'
            });
        }

        const rdService = new RealDebridService();
        const magnetHash = magnet.match(/btih:([a-zA-Z0-9]+)/i)?.[1];
        
        if (!magnetHash) {
            return res.status(400).json({
                success: false,
                error: 'Magnet link inválido'
            });
        }

        // Busca torrent existente no Real-Debrid
        const existingTorrent = await rdService.findExistingTorrent(magnetHash, apiKey);
        
        if (existingTorrent && existingTorrent.id) {
            const torrentInfo = await rdService.getTorrentInfo(existingTorrent.id, apiKey);
            
            return res.json({
                success: true,
                status: torrentInfo.status,
                progress: Math.round(torrentInfo.progress),
                downloaded: torrentInfo.status === 'downloaded',
                message: getStatusMessage(torrentInfo.status, torrentInfo.progress),
                torrentId: existingTorrent.id
            });
        } else {
            return res.json({
                success: true,
                status: 'not_found',
                progress: 0,
                downloaded: false,
                message: 'Torrent não encontrado no Real-Debrid'
            });
        }

    } catch (error) {
        logger.error('Erro ao verificar status do magnet', {
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        
        res.status(500).json({
            success: false,
            error: 'Falha ao verificar status: ' + (error instanceof Error ? error.message : 'Unknown error')
        });
    }
});

// Helper para mensagens de status
function getStatusMessage(status: string, progress: number): string {
    const messages: Record<string, string> = {
        'downloaded': 'Conteúdo pronto para assistir',
        'downloading': `Baixando... ${Math.round(progress)}% concluído`,
        'queued': 'Na fila de download',
        'magnet_conversion': 'Convertendo magnet...',
        'uploading': 'Fazendo upload...',
        'compressing': 'Comprimindo arquivos...',
        'error': 'Erro no processamento',
        'dead': 'Torrent sem seeds',
        'virus': 'Arquivo infectado detectado'
    };
    
    return messages[status] || `Status: ${status}`;
}

// Rota para limpar cache
app.delete('/cache', (req: any, res: any) => {
    cacheService.clear();
    logger.info('Cache limpo manualmente');
    res.json({ 
        success: true, 
        message: 'Cache limpo'
    });
});

// Rota para status do cache
app.get('/cache/status', (req: any, res: any) => {
    res.json({
        status: 'CacheService em uso',
        ttl: CACHE_TTL + 'ms',
        feature: 'Cache distribuído por chave'
    });
});

// Rota raiz redireciona para configuração
app.get('/', (req: any, res: any) => {
    res.redirect('/configure');
});

// Configuração de HTTPS (Opcional)
function createServer() {
    const port = process.env.PORT ? parseInt(process.env.PORT) : 7000;
    
    const sslOptions = getSSLOptions();
    
    if (sslOptions) {
        const httpsServer = https.createServer(sslOptions, app);
        httpsServer.listen(port, '0.0.0.0', () => {
            logServerStart(port, true);
        });
        return httpsServer;
    } else {
        return app.listen(port, '0.0.0.0', () => {
            logServerStart(port, false);
        });
    }
}

function getSSLOptions() {
    try {
        const privateKeyPath = process.env.SSL_PRIVATE_KEY;
        const certificatePath = process.env.SSL_CERTIFICATE;
        
        if (privateKeyPath && certificatePath && 
            fs.existsSync(privateKeyPath) && fs.existsSync(certificatePath)) {
            
            return {
                key: fs.readFileSync(privateKeyPath),
                cert: fs.readFileSync(certificatePath)
            };
        }
        
        logger.info('SSL não configurado - usando HTTP para desenvolvimento');
        return null;
        
    } catch (error) {
        logger.warn('Erro ao carregar certificados SSL', {
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        return null;
    }
}

function logServerStart(port: number, httpsEnabled: boolean) {
   const protocol = httpsEnabled ? 'https' : 'http';
const host = process.env.RAILWAY_STATIC_URL ? 
    (process.env.RAILWAY_STATIC_URL.startsWith('http') ? 
        new URL(process.env.RAILWAY_STATIC_URL).hostname : 
        process.env.RAILWAY_STATIC_URL) : 
    `localhost:${port}`;

logger.info('Brasil RD Addon iniciado com sucesso', {
    port,
    protocol,
    configurable: true,
    environment: process.env.NODE_ENV || 'production',
    cacheEnabled: true,
    httpsEnabled,
    features: ['auto-magnet', 'smart-resolve', 'real-debrid-check']
});

    console.log('=== BRASIL RD ADDON (MODO INTELIGENTE) ===');
    console.log(`Addon rodando: ${protocol}://${host}/manifest.json`);
    console.log(`Interface de config: ${protocol}://${host}/configure`);
    console.log(`Health check: ${protocol}://${host}/health`);
    console.log(`Rota de resolução: ${protocol}://${host}/resolve/{magnet}?apiKey=...`);
    console.log('');
    console.log('NOVAS FUNCIONALIDADES:');
    console.log('- Auto-salvamento de magnets no catálogo');
    console.log('- Verificação inteligente: "Real-Debrid, você tem este magnet?"');
    console.log('- Stream instantâneo se já estiver baixado');
    console.log('- Status em tempo real se estiver baixando');
    console.log('- Cache inteligente de 24h');
    console.log('');
    console.log('FLUXO INTELIGENTE:');
    console.log('1. Usuário clica no stream → Pergunta ao Real-Debrid');
    console.log('2. Se já tem: Stream instantâneo');
    console.log('3. Se não tem: Adiciona e mostra progresso');
    console.log('4. Próximo usuário: Já está no catálogo');
    console.log('');
    
    if (!httpsEnabled && !process.env.RAILWAY_STATIC_URL) {
        console.log('PARA HTTPS: Defina SSL_PRIVATE_KEY e SSL_CERTIFICATE no .env');
    }
}

// Iniciar servidor
createServer();