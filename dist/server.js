import { addonBuilder, getRouter } from 'stremio-addon-sdk';
import express from 'express';
import cors from 'cors';
import { StreamHandler } from './services/StreamHandler.js';
import { Logger } from './utils/logger.js';
import { syncDatabase } from './database/repository.js';
const logger = new Logger('Main');
const streamHandler = new StreamHandler();
const app = express();
app.use(cors());
app.use(express.json());
const manifest = {
    id: 'org.brasilrd.addon',
    version: '1.0.0',
    name: 'Brasil RD',
    description: 'Addon brasileiro com suporte ao Real-Debrid',
    logo: 'https://raw.githubusercontent.com/Stremio/stremio-art/main/placeholder/icon-256.png',
    background: 'https://raw.githubusercontent.com/Stremio/stremio-art/main/placeholder/background-1920x1080.jpg',
    contactEmail: '',
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
            title: 'Chave de API do Real-Debrid',
            required: true,
            placeholder: 'Cole sua chave de API aqui'
        }
    ]
};
const builder = new addonBuilder(manifest);
builder.defineStreamHandler(async (args) => {
    const requestStartTime = Date.now();
    if (!args.config?.apiKey) {
        logger.warn('Stream request without API key', {
            type: args.type,
            id: args.id
        });
        return { streams: [] };
    }
    try {
        const result = await streamHandler.handleStreamRequest({
            type: args.type,
            id: args.id,
            apiKey: args.config.apiKey
        });
        const processingTime = Date.now() - requestStartTime;
        logger.info('Stream request completed', {
            requestId: args.id,
            streamsCount: result.streams.length,
            processingTime: `${processingTime}ms`
        });
        return result;
    }
    catch (error) {
        logger.error('Stream handler error', {
            requestId: args.id,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        return { streams: [] };
    }
});
const stremioRouter = getRouter(builder.getInterface());
app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'max-age=600, public');
    next();
});
app.get('/configure', (req, res) => {
    const landingHTML = `
        <!DOCTYPE html>
        <html style="background-image: url(${manifest.background});">
        <head>
            <meta charset="utf-8">
            <title>${manifest.name} - Stremio Addon</title>
            <style>
                body {
                    margin: 0;
                    padding: 20px;
                    font-family: 'Open Sans', Arial, sans-serif;
                    color: white;
                    background: linear-gradient(rgba(0,0,0,0.7), rgba(0,0,0,0.7));
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                #addon {
                    text-align: center;
                    max-width: 400px;
                }
                .logo img {
                    width: 100px;
                    height: 100px;
                    border-radius: 10px;
                }
                h1 { margin: 10px 0 5px 0; }
                h2 { 
                    margin: 0 0 20px 0; 
                    font-weight: normal;
                    opacity: 0.8;
                }
                input {
                    width: 100%;
                    padding: 12px;
                    margin: 10px 0;
                    border: 1px solid #ccc;
                    border-radius: 5px;
                    font-size: 16px;
                }
                button {
                    width: 100%;
                    padding: 12px;
                    background: #8A5AAB;
                    color: white;
                    border: none;
                    border-radius: 5px;
                    font-size: 16px;
                    cursor: pointer;
                    margin-top: 10px;
                }
                button:hover {
                    background: #7a4a9b;
                }
                .info {
                    font-size: 14px;
                    margin: 10px 0;
                    opacity: 0.8;
                }
            </style>
        </head>
        <body>
            <div id="addon">
                <div class="logo">
                    <img src="${manifest.logo}">
                </div>
                <h1>${manifest.name}</h1>
                <h2>${manifest.description}</h2>
                
                <form id="mainForm">
                    <div>
                        <label>Chave de API do Real-Debrid</label>
                        <input type="text" 
                               id="${manifest.config[0].key}" 
                               name="${manifest.config[0].key}" 
                               required 
                               placeholder="${manifest.config[0].placeholder}"/>
                    </div>
                    
                    <div class="info">
                        Obtenha sua chave em: 
                        <a href="https://real-debrid.com/apitoken" 
                           target="_blank" 
                           style="color: #34c5db;">
                           real-debrid.com/apitoken
                        </a>
                    </div>
                    
                    <a id="installLink" style="text-decoration: none;">
                        <button type="button">INSTALAR NO STREMIO</button>
                    </a>
                </form>
            </div>
            
            <script>
                document.getElementById('installLink').onclick = () => {
                    if (!document.getElementById('mainForm').reportValidity()) {
                        return false;
                    }
                };
                
                const updateLink = () => {
                    const formData = new FormData(document.getElementById('mainForm'));
                    const config = Object.fromEntries(formData);
                    const installLink = document.getElementById('installLink');
                    installLink.href = 'stremio://' + window.location.host + '/' + 
                                      encodeURIComponent(JSON.stringify(config)) + 
                                      '/manifest.json';
                };
                
                document.getElementById('mainForm').addEventListener('input', updateLink);
                updateLink();
            </script>
        </body>
        </html>
    `;
    res.setHeader('content-type', 'text/html');
    res.end(landingHTML);
});
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'Brasil RD Addon',
        version: manifest.version
    });
});
app.get('/', (req, res) => {
    res.redirect('/configure');
});
app.use(stremioRouter);
async function initialize() {
    try {
        await syncDatabase();
        logger.info('Database synchronized');
        const port = process.env.PORT ? parseInt(process.env.PORT) : 7000;
        const host = process.env.RAILWAY_STATIC_URL || `localhost:${port}`;
        const protocol = process.env.RAILWAY_STATIC_URL ? 'https' : 'http';
        app.listen(port, '0.0.0.0', () => {
            logger.info('Brasil RD Addon started successfully', {
                port,
                protocol,
                configUrl: `${protocol}://${host}/configure`
            });
            console.log('=== BRASIL RD ADDON ===');
            console.log(`Addon URL: ${protocol}://${host}/manifest.json`);
            console.log(`Configure: ${protocol}://${host}/configure`);
            console.log(`Health: ${protocol}://${host}/health`);
            console.log('');
            console.log('🎯 FEATURES:');
            console.log('✅ Database-backed streams (Torrentio style)');
            console.log('✅ Real-Debrid integration');
            console.log('✅ Quality filtering & sorting');
            console.log('✅ Mobile compatible');
            console.log('');
            console.log('⚡ PRONTO PARA USAR!');
        });
    }
    catch (error) {
        logger.error('Failed to initialize application', {
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        process.exit(1);
    }
}
initialize();
