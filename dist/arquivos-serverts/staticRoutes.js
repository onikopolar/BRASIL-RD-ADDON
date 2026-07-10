"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupStaticRoutes = void 0;
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const logger_1 = require("../utils/logger");
const StaticResponseService_1 = require("../services/StaticResponseService");
const logger = new logger_1.Logger('StaticRoutes');
function getIconForResponse(response) {
    switch (response) {
        case StaticResponseService_1.StaticResponse.DOWNLOADING:
            return '';
        case StaticResponseService_1.StaticResponse.FAILED_DOWNLOAD:
            return '';
        case StaticResponseService_1.StaticResponse.FAILED_ACCESS:
            return '';
        case StaticResponseService_1.StaticResponse.FAILED_RAR:
            return '';
        case StaticResponseService_1.StaticResponse.FAILED_TOO_BIG:
            return '';
        case StaticResponseService_1.StaticResponse.FAILED_OPENING:
            return '';
        case StaticResponseService_1.StaticResponse.FAILED_UNEXPECTED:
            return '';
        case StaticResponseService_1.StaticResponse.FAILED_INFRINGEMENT:
            return '';
        case StaticResponseService_1.StaticResponse.LIMITS_EXCEEDED:
            return '';
        case StaticResponseService_1.StaticResponse.BLOCKED_ACCESS:
            return '';
        default:
            return '';
    }
}
const videoFileMap = {
    [StaticResponseService_1.StaticResponse.DOWNLOADING]: 'downloading_v2.mp4',
    [StaticResponseService_1.StaticResponse.FAILED_DOWNLOAD]: 'download_failed_v2.mp4',
    [StaticResponseService_1.StaticResponse.FAILED_ACCESS]: 'failed_access_v2.mp4',
    [StaticResponseService_1.StaticResponse.FAILED_RAR]: 'failed_rar_v2.mp4',
    [StaticResponseService_1.StaticResponse.FAILED_TOO_BIG]: 'failed_too_big_v1.mp4',
    [StaticResponseService_1.StaticResponse.FAILED_OPENING]: 'failed_opening_v2.mp4',
    [StaticResponseService_1.StaticResponse.FAILED_UNEXPECTED]: 'failed_unexpected_v2.mp4',
    [StaticResponseService_1.StaticResponse.FAILED_INFRINGEMENT]: 'failed_infringement_v2.mp4',
    [StaticResponseService_1.StaticResponse.LIMITS_EXCEEDED]: 'limits_exceeded_v1.mp4',
    [StaticResponseService_1.StaticResponse.BLOCKED_ACCESS]: 'blocked_access_v1.mp4'
};
const setupStaticRoutes = (app) => {
    const videosPath = path_1.default.join(__dirname, '..', 'videos');
    app.use('/static/videos', express_1.default.static(videosPath));
    logger.info('Servindo vídeos estáticos da pasta', { path: videosPath });
    app.get('/static/video/:response', (req, res) => {
        try {
            const responseName = req.params.response;
            const validResponses = Object.values(StaticResponseService_1.StaticResponse);
            if (!validResponses.includes(responseName)) {
                return res.status(404).json({
                    error: 'Vídeo estático não encontrado',
                    availableResponses: validResponses
                });
            }
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            const staticResponseService = new StaticResponseService_1.StaticResponseService(baseUrl);
            const responseInfo = staticResponseService.getResponseInfo(responseName);
            const videoFileName = videoFileMap[responseName];
            if (!videoFileName) {
                return res.status(404).json({
                    error: 'Arquivo de vídeo não encontrado para esta resposta'
                });
            }
            logger.info('Servindo vídeo estático local', {
                response: responseName,
                name: responseInfo.name,
                videoFile: videoFileName,
                baseUrl: baseUrl
            });
            const videoUrl = `/static/videos/${videoFileName}`;
            return res.redirect(302, videoUrl);
        }
        catch (error) {
            logger.error('Erro ao servir vídeo estático', {
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            return res.status(500).send('Erro interno ao servir vídeo estático');
        }
    });
    app.get('/static/:response', (req, res) => {
        try {
            const responseName = req.params.response;
            const validResponses = Object.values(StaticResponseService_1.StaticResponse);
            if (!validResponses.includes(responseName)) {
                return res.status(404).json({
                    error: 'Resposta estática não encontrada',
                    availableResponses: validResponses
                });
            }
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            const staticResponseService = new StaticResponseService_1.StaticResponseService(baseUrl);
            const responseInfo = staticResponseService.getResponseInfo(responseName);
            const videoFileName = videoFileMap[responseName];
            logger.info('Servindo resposta estática', {
                response: responseName,
                name: responseInfo.name,
                videoFile: videoFileName,
                baseUrl: baseUrl
            });
            return res.json({
                type: 'static_response',
                response: responseName,
                name: responseInfo.name,
                title: responseInfo.title,
                description: responseInfo.description,
                video: {
                    available: !!videoFileName,
                    filename: videoFileName,
                    url: responseInfo.url,
                    local_path: videoFileName ? path_1.default.join(videosPath, videoFileName) : null,
                    direct_url: `/static/video/${responseName}`
                },
                note: 'Use /static/video/{response} para obter o vídeo diretamente'
            });
        }
        catch (error) {
            logger.error('Erro ao processar rota estática', {
                error: error instanceof Error ? error.message : 'Unknown error',
                response: req.params.response
            });
            return res.status(500).json({
                error: 'Erro interno ao processar resposta estática',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });
    app.get('/static/html/:response', (req, res) => {
        try {
            const responseName = req.params.response;
            const validResponses = Object.values(StaticResponseService_1.StaticResponse);
            if (!validResponses.includes(responseName)) {
                return res.status(404).send('Página estática não encontrada');
            }
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            const staticResponseService = new StaticResponseService_1.StaticResponseService(baseUrl);
            const responseInfo = staticResponseService.getResponseInfo(responseName);
            const videoFileName = videoFileMap[responseName];
            const videoUrl = videoFileName ? `/static/videos/${videoFileName}` : null;
            const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Brasil RD - ${responseInfo.name}</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            margin: 0;
            padding: 20px;
            display: flex;
            flex-direction: column;
            align-items: center;
            min-height: 100vh;
            color: white;
        }
        .container {
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 40px;
            max-width: 800px;
            width: 90%;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            text-align: center;
            margin: 20px 0;
        }
        .icon {
            font-size: 4rem;
            margin-bottom: 20px;
        }
        h1 {
            font-size: 2.5rem;
            margin-bottom: 20px;
            color: white;
        }
        .message {
            font-size: 1.2rem;
            line-height: 1.6;
            margin-bottom: 30px;
            white-space: pre-line;
            background: rgba(0, 0, 0, 0.2);
            padding: 20px;
            border-radius: 10px;
        }
        .video-container {
            margin: 30px 0;
            width: 100%;
            max-width: 600px;
        }
        video {
            width: 100%;
            border-radius: 10px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        }
        .actions {
            margin-top: 30px;
            display: flex;
            gap: 15px;
            flex-wrap: wrap;
            justify-content: center;
        }
        .action-btn {
            background: rgba(255, 255, 255, 0.2);
            border: 2px solid rgba(255, 255, 255, 0.3);
            color: white;
            padding: 12px 24px;
            border-radius: 50px;
            font-size: 1rem;
            cursor: pointer;
            transition: all 0.3s ease;
            text-decoration: none;
            display: inline-block;
        }
        .action-btn:hover {
            background: rgba(255, 255, 255, 0.3);
            transform: translateY(-2px);
        }
        .details {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid rgba(255, 255, 255, 0.2);
            font-size: 0.9rem;
            opacity: 0.8;
            text-align: left;
            width: 100%;
        }
        .no-video {
            background: rgba(255, 0, 0, 0.1);
            padding: 15px;
            border-radius: 10px;
            margin: 20px 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">
            ${getIconForResponse(responseName)}
        </div>
        <h1>${responseInfo.name}</h1>
        
        <div class="message">
            ${responseInfo.description}
        </div>
        
        ${videoFileName ? `
        <div class="video-container">
            <h3>Vídeo Informativo:</h3>
            <video controls>
                <source src="${videoUrl}" type="video/mp4">
                Seu navegador não suporta a reprodução de vídeo.
            </video>
            <p><a href="${videoUrl}" target="_blank" class="action-btn">Abrir vídeo diretamente</a></p>
        </div>
        ` : `
        <div class="no-video">
            <p>Vídeo informativo não disponível para esta resposta.</p>
        </div>
        `}
        
        <div class="actions">
            <a href="/configure" class="action-btn">Configurar Addon</a>
            <a href="/static" class="action-btn">Todas as Respostas</a>
            <a href="/" class="action-btn">Voltar</a>
        </div>
        
        <div class="details">
            <p><strong>Status:</strong> ${responseName}</p>
            <p><strong>Serviço:</strong> Brasil RD Addon</p>
            <p><strong>Arquivo de vídeo:</strong> ${videoFileName || 'Não disponível'}</p>
            <p><strong>Endpoints relacionados:</strong></p>
            <ul>
                <li><a href="/static/${responseName}" style="color: #a3e4ff;">/static/${responseName}</a> (JSON)</li>
                <li><a href="/static/video/${responseName}" style="color: #a3e4ff;">/static/video/${responseName}</a> (Vídeo)</li>
                ${videoFileName ? `<li><a href="${videoUrl}" style="color: #a3e4ff;">${videoUrl}</a> (Vídeo direto)</li>` : ''}
            </ul>
        </div>
    </div>
</body>
</html>
            `;
            res.setHeader('Content-Type', 'text/html');
            return res.send(html);
        }
        catch (error) {
            logger.error('Erro ao gerar página HTML estática', {
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            return res.status(500).send('Erro interno ao gerar página');
        }
    });
    app.get('/static', (req, res) => {
        try {
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            const staticResponseService = new StaticResponseService_1.StaticResponseService(baseUrl);
            const validResponses = Object.values(StaticResponseService_1.StaticResponse);
            const responses = validResponses.map(response => {
                const info = staticResponseService.getResponseInfo(response);
                const videoFileName = videoFileMap[response];
                return {
                    response,
                    name: info.name,
                    description: info.description,
                    video: {
                        available: !!videoFileName,
                        filename: videoFileName,
                        url: info.url,
                        direct_url: `/static/video/${response}`
                    },
                    endpoints: {
                        json: `/static/${response}`,
                        html: `/static/html/${response}`,
                        video: `/static/video/${response}`
                    }
                };
            });
            return res.json({
                service: 'Brasil RD Static Responses',
                description: 'Sistema de respostas estáticas com vídeos informativos',
                video_path: videosPath,
                base_url: baseUrl,
                total_responses: responses.length,
                responses
            });
        }
        catch (error) {
            logger.error('Erro ao listar respostas estáticas', {
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            return res.status(500).json({
                error: 'Erro interno ao listar respostas estáticas'
            });
        }
    });
    if (process.env.NODE_ENV !== 'production') {
        app.get('/static/test-videos', (req, res) => {
            const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Teste de Todos os Vídeos - Brasil RD Addon</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; }
        h1 { color: #333; }
        .video-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); gap: 20px; }
        .video-card { background: white; padding: 15px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
        video { width: 100%; max-width: 400px; }
    </style>
</head>
<body>
    <h1>Teste de Todos os Vídeos Informativos</h1>
    <div class="video-grid">
        ${Object.entries(videoFileMap).map(([response, filename]) => `
        <div class="video-card">
            <h3>${response}</h3>
            <p><strong>Arquivo:</strong> ${filename}</p>
            <video controls>
                <source src="/static/videos/${filename}" type="video/mp4">
            </video>
            <p><a href="/static/video/${response}">Abrir via redirecionamento</a></p>
        </div>
        `).join('')}
    </div>
</body>
</html>
            `;
            res.send(html);
        });
    }
    logger.info('Rotas estáticas configuradas com vídeos locais', {
        endpoints: [
            'GET /static',
            'GET /static/{response}',
            'GET /static/html/{response}',
            'GET /static/video/{response}',
            'GET /static/videos/{filename}.mp4',
            ...(process.env.NODE_ENV !== 'production' ? ['GET /static/test-videos'] : [])
        ],
        videos_available: Object.keys(videoFileMap).length,
        video_files: Object.values(videoFileMap)
    });
};
exports.setupStaticRoutes = setupStaticRoutes;
