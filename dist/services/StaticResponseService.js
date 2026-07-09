"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StaticResponseService = exports.StaticResponse = void 0;
const logger_1 = require("../utils/logger");
var StaticResponse;
(function (StaticResponse) {
    StaticResponse["DOWNLOADING"] = "downloading";
    StaticResponse["FAILED_DOWNLOAD"] = "failed_download";
    StaticResponse["FAILED_ACCESS"] = "failed_access";
    StaticResponse["FAILED_RAR"] = "failed_rar";
    StaticResponse["FAILED_TOO_BIG"] = "failed_too_big";
    StaticResponse["FAILED_OPENING"] = "failed_opening";
    StaticResponse["FAILED_UNEXPECTED"] = "failed_unexpected";
    StaticResponse["FAILED_INFRINGEMENT"] = "failed_infringement";
    StaticResponse["LIMITS_EXCEEDED"] = "limits_exceeded";
    StaticResponse["BLOCKED_ACCESS"] = "blocked_access";
})(StaticResponse || (exports.StaticResponse = StaticResponse = {}));
class StaticResponseService {
    constructor(baseUrl) {
        this.logger = new logger_1.Logger('StaticResponseService');
        this.baseUrl = baseUrl || this.getBaseUrl();
    }
    getBaseUrl() {
        if (process.env.BASE_URL)
            return process.env.BASE_URL;
        if (process.env.RAILWAY_STATIC_URL) {
            const railwayUrl = process.env.RAILWAY_STATIC_URL;
            if (railwayUrl.startsWith('http'))
                return railwayUrl;
            return `https://${railwayUrl}`;
        }
        const port = process.env.PORT ? parseInt(process.env.PORT) : 7000;
        return `http://localhost:${port}`;
    }
    setBaseUrl(baseUrl) {
        this.baseUrl = baseUrl;
    }
    getResponseInfo(response) {
        const videoFileMap = {
            [StaticResponse.DOWNLOADING]: 'downloading_v2.mp4',
            [StaticResponse.FAILED_DOWNLOAD]: 'download_failed_v2.mp4',
            [StaticResponse.FAILED_ACCESS]: 'failed_access_v2.mp4',
            [StaticResponse.FAILED_RAR]: 'failed_rar_v2.mp4',
            [StaticResponse.FAILED_TOO_BIG]: 'failed_too_big_v1.mp4',
            [StaticResponse.FAILED_OPENING]: 'failed_opening_v2.mp4',
            [StaticResponse.FAILED_UNEXPECTED]: 'failed_unexpected_v2.mp4',
            [StaticResponse.FAILED_INFRINGEMENT]: 'failed_infringement_v2.mp4',
            [StaticResponse.LIMITS_EXCEEDED]: 'limits_exceeded_v1.mp4',
            [StaticResponse.BLOCKED_ACCESS]: 'blocked_access_v1.mp4'
        };
        const videoFileName = videoFileMap[response];
        const videoUrl = videoFileName ? `/videos/${videoFileName}` : `/videos/downloading_v2.mp4`;
        const responses = {
            [StaticResponse.DOWNLOADING]: {
                name: 'Baixando',
                title: 'Brasil RD - Baixando',
                description: 'Torrent sendo baixado pelo Torbox\nAguarde 1-10 minutos',
                url: videoUrl,
                videoUrl: videoUrl
            },
            [StaticResponse.FAILED_DOWNLOAD]: {
                name: 'Download falhou',
                title: 'Brasil RD - Falhou',
                description: 'Falha ao baixar torrent\nTente outro magnet link',
                url: videoUrl,
                videoUrl: videoUrl
            },
            [StaticResponse.FAILED_ACCESS]: {
                name: 'Chave API invalida',
                title: 'Brasil RD - API invalida',
                description: 'Chave do Torbox invalida\nObtenha nova chave em torbox.app',
                url: videoUrl,
                videoUrl: videoUrl
            },
            [StaticResponse.FAILED_RAR]: {
                name: 'Arquivo RAR',
                title: 'Brasil RD - RAR/ZIP',
                description: 'Contem arquivos compactados\nAguarde extracao ou tente outro',
                url: videoUrl,
                videoUrl: videoUrl
            },
            [StaticResponse.FAILED_TOO_BIG]: {
                name: 'Muito grande',
                title: 'Brasil RD - Grande demais',
                description: 'Torrent excede limite do Torbox\nTente versao menor',
                url: videoUrl,
                videoUrl: videoUrl
            },
            [StaticResponse.FAILED_OPENING]: {
                name: 'Erro no magnet',
                title: 'Brasil RD - Magnet invalido',
                description: 'Nao conseguiu processar magnet link\nVerifique o link',
                url: videoUrl,
                videoUrl: videoUrl
            },
            [StaticResponse.FAILED_UNEXPECTED]: {
                name: 'Erro inesperado',
                title: 'Brasil RD - Erro',
                description: 'Ocorreu um erro inesperado\nTente novamente',
                url: videoUrl,
                videoUrl: videoUrl
            },
            [StaticResponse.FAILED_INFRINGEMENT]: {
                name: 'Bloqueado',
                title: 'Brasil RD - Bloqueado',
                description: 'Conteudo removido por direitos autorais\nTente outra fonte',
                url: videoUrl,
                videoUrl: videoUrl
            },
            [StaticResponse.LIMITS_EXCEEDED]: {
                name: 'Limites excedidos',
                title: 'Brasil RD - Limites',
                description: 'Limites do Torbox excedidos\nAguarde ou faca upgrade',
                url: videoUrl,
                videoUrl: videoUrl
            },
            [StaticResponse.BLOCKED_ACCESS]: {
                name: 'Acesso bloqueado',
                title: 'Brasil RD - Acesso bloqueado',
                description: 'Acesso ao Torbox bloqueado\nVerifique sua conta',
                url: videoUrl,
                videoUrl: videoUrl
            }
        };
        return responses[response];
    }
    createInformativeStream(response, requestId) {
        const info = this.getResponseInfo(response);
        return {
            title: info.title,
            name: `Brasil RD - ${info.name}`,
            description: `${info.description}${requestId ? `\nID: ${requestId}` : ''}`,
            url: info.url,
            behaviorHints: {
                notWebReady: false
            }
        };
    }
    createInformativeStreamWithStatus(response, rdStatus, progress, requestId) {
        const info = this.getResponseInfo(response);
        let description = info.description;
        if (rdStatus)
            description += `\nStatus Torbox: ${rdStatus}`;
        if (progress !== undefined)
            description += `\nProgresso: ${progress}%`;
        if (requestId)
            description += `\nID: ${requestId}`;
        return {
            title: info.title,
            name: `Brasil RD - ${info.name}`,
            description: description,
            url: info.url,
            behaviorHints: {
                notWebReady: false
            }
        };
    }
    getResponseForTorboxStatus(torboxStatus) {
        const statusMap = {
            'downloading': StaticResponse.DOWNLOADING,
            'metaDL': StaticResponse.DOWNLOADING,
            'stalled': StaticResponse.DOWNLOADING,
            'checkingResumeData': StaticResponse.DOWNLOADING,
            'paused': StaticResponse.DOWNLOADING,
            'queued': StaticResponse.DOWNLOADING,
            'error': StaticResponse.FAILED_DOWNLOAD,
            'missingFiles': StaticResponse.FAILED_DOWNLOAD,
            'unknown': StaticResponse.FAILED_DOWNLOAD,
        };
        const lower = torboxStatus?.toLowerCase() || '';
        for (const [key, value] of Object.entries(statusMap)) {
            if (lower.includes(key))
                return value;
        }
        return null;
    }
    isInformativeStream(stream) {
        if (!stream?.url)
            return false;
        const url = stream.url.toLowerCase();
        return (url.includes('/videos/') ||
            url.includes('downloading_v2.mp4') ||
            url.includes('download_failed_v2.mp4') ||
            url.includes('failed_access_v2.mp4'));
    }
    getVideoUrlForResponse(response) {
        const info = this.getResponseInfo(response);
        return info.url;
    }
    listAllResponses() {
        return Object.values(StaticResponse).map(response => {
            const info = this.getResponseInfo(response);
            return {
                response,
                name: info.name,
                videoUrl: info.url
            };
        });
    }
}
exports.StaticResponseService = StaticResponseService;
exports.default = StaticResponseService;
