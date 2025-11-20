import { addonBuilder, getRouter } from 'stremio-addon-sdk';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import https from 'https';
import { StreamHandler } from './services/StreamHandler';
import { RealDebridService } from './services/RealDebridService';
import { CacheService } from './services/CacheService';
import { Logger } from './utils/logger';
import { StreamRequest } from './types';

const logger = new Logger('Main');
const streamHandler = new StreamHandler();
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
        p2p: true
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

// Rota de resolução sob demanda
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
        logger.info('Resolvendo magnet sob demanda', {
            magnet: magnet.substring(0, 100) + '...',
            apiKey: apiKey ? apiKey.substring(0, 8) + '...' : 'none',
            cacheMiss: true
        });

        if (!apiKey) {
            return res.status(400).json({
                success: false,
                error: 'API key do Real-Debrid é obrigatória'
            });
        }

        const rdService = new RealDebridService();
        
        const magnetHash = magnet.match(/btih:([a-zA-Z0-9]+)/i)?.[1];
        let existingTorrent = null;
        
        if (magnetHash) {
            existingTorrent = await rdService.findExistingTorrent(magnetHash, apiKey);
        }

        let torrentId: string;
        
        if (existingTorrent && existingTorrent.id) {
            torrentId = existingTorrent.id;
            logger.info('Torrent já existe no Real-Debrid', { 
                torrentId,
                status: existingTorrent.status,
                progress: existingTorrent.progress
            });
        } else {
            const processResult = await rdService.processTorrent(magnet, apiKey);
            
            if (!processResult.added || !processResult.torrentId) {
                throw new Error('Falha ao adicionar magnet no Real-Debrid');
            }

            torrentId = processResult.torrentId;
            logger.info('Magnet adicionado ao Real-Debrid', { torrentId });
        }

        let torrentInfo;
        let attempts = 0;
        const maxAttempts = existingTorrent?.status === 'downloaded' ? 1 : 30;
        
        while (attempts < maxAttempts) {
            torrentInfo = await rdService.getTorrentInfo(torrentId, apiKey);
            
            if (torrentInfo.status === 'downloaded') {
                logger.info('Torrent pronto no Real-Debrid', { 
                    torrentId,
                    totalAttempts: attempts + 1
                });
                break;
            }
            
            if (torrentInfo.status === 'downloading' || torrentInfo.status === 'queued' || torrentInfo.status === 'uploading') {
                const progress = Math.round(torrentInfo.progress);
                logger.info('Aguardando download do torrent', { 
                    torrentId, 
                    progress: progress + '%',
                    attempt: attempts + 1
                });
                
                const delay = progress > 80 ? 2000 : 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
                attempts++;
            } else {
                throw new Error('Status do torrent não suportado: ' + torrentInfo.status);
            }
        }

        if (attempts >= maxAttempts || !torrentInfo) {
            throw new Error('Timeout aguardando download do torrent');
        }

        const videoFiles = (torrentInfo.files || []).filter(file =>
            /\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v|mpg|mpeg|ts|mts|vob)$/i.test(file.path)
        );

        if (videoFiles.length === 0) {
            throw new Error('Nenhum arquivo de vídeo encontrado no torrent');
        }

        // Log detalhado para diagnóstico
        logger.debug('DEBUG - Informações do torrent', {
            torrentId,
            filesCount: torrentInfo.files?.length || 0,
            videoFilesCount: videoFiles.length,
            linksCount: torrentInfo.links?.length || 0,
            selectedFilesCount: torrentInfo.files?.filter(f => f.selected === 1).length || 0
        });

        const sortedFiles = videoFiles
            .map(file => {
                let priority = file.bytes;
                
                if (/1080p|720p|2160p|4k/i.test(file.path)) {
                    priority *= 1.5;
                }
                
                if (/sample|trailer|teaser/i.test(file.path)) {
                    priority *= 0.1;
                }
                
                return { ...file, priority };
            })
            .sort((a, b) => b.priority - a.priority);

        const selectedFile = sortedFiles[0];
        logger.info('Arquivo de vídeo principal selecionado automaticamente', {
            filename: selectedFile.path,
            size: selectedFile.bytes,
            fileId: selectedFile.id
        });

        const directLink = await rdService.getStreamLinkForFile(torrentId, selectedFile.id, apiKey);
        
        if (!directLink) {
            throw new Error('Falha ao gerar link direto do arquivo');
        }

        cacheService.set(cacheKey, directLink, CACHE_TTL);

        logger.info('Redirecionando para link direto do Real-Debrid', {
            filename: selectedFile.path,
            directLink: directLink.substring(0, 100) + '...',
            cached: true
        });

        res.redirect(302, directLink);

    } catch (error) {
        logger.error('Erro ao resolver magnet', {
            error: error instanceof Error ? error.message : 'Unknown error',
            cacheKey
        });
        res.status(500).json({
            success: false,
            error: 'Falha ao resolver o stream: ' + (error instanceof Error ? error.message : 'Unknown error')
        });
    }
});

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
        httpsServer.listen(port, () => {
            logServerStart(port, true);
        });
        return httpsServer;
    } else {
        return app.listen(port, () => {
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
    
    logger.info('Brasil RD Addon iniciado com sucesso', {
        port,
        protocol,
        configurable: true,
        environment: process.env.NODE_ENV || 'development',
        cacheEnabled: true,
        httpsEnabled
    });

    console.log('=== BRASIL RD ADDON ===');
    console.log('Addon rodando: ' + protocol + '://localhost:' + port + '/manifest.json');
    console.log('Interface de config: ' + protocol + '://localhost:' + port + '/configure');
    console.log('Health check: ' + protocol + '://localhost:' + port + '/health');
    console.log('Rota de resolução: ' + protocol + '://localhost:' + port + '/resolve/{magnet}?apiKey=...');
    console.log('');
    console.log('CONFIGURACAO:');
    console.log('- 15 streams por requisicao');
    console.log('- Todas as qualidades automaticamente');
    console.log('- Busca otimizada por conteudo');
    console.log('- Cache inteligente de 24h');
    console.log('');
    console.log('PLATAFORMAS SUPORTADAS:');
    console.log('- Desktop (Windows, macOS, Linux)');
    console.log('- Mobile (Android, iOS)');
    console.log('- TV (Android TV, Smart TVs)');
    console.log('');
    
    if (!httpsEnabled) {
        console.log('PARA HTTPS: Defina SSL_PRIVATE_KEY e SSL_CERTIFICATE no .env');
    }
}

// Iniciar servidor
createServer();