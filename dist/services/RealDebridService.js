"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TorboxService = void 0;
const axios_1 = __importDefault(require("axios"));
const index_js_1 = require("../config/index.js");
const logger_js_1 = require("../utils/logger.js");
const StaticResponseService_js_1 = require("./StaticResponseService.js");
const StreamStatusException_js_1 = require("./StreamStatusException.js");
const episodeMatcher_js_1 = require("../lib/episodeMatcher.js");
const magnetHelper_js_1 = require("../lib/magnetHelper.js");
class TorboxService {
    constructor(baseUrl) {
        this.maxRetries = 3;
        this.baseDelay = 1000;
        this.videoExtensions = [
            '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v',
            '.mpg', '.mpeg', '.3gp', '.ts', '.mts', '.m2ts', '.vob'
        ];
        this.episodeMatcher = episodeMatcher_js_1.EpisodeMatcher.getInstance();
        this.logger = new logger_js_1.Logger('TorboxService');
        this.staticResponseService = new StaticResponseService_js_1.StaticResponseService(baseUrl);
    }
    setStaticResponseBaseUrl(baseUrl) {
        this.staticResponseService.setBaseUrl(baseUrl);
    }
    createHttpClient(apiKey) {
        if (!apiKey || apiKey.trim().length === 0) {
            throw new Error('Torbox API Key is required');
        }
        const client = axios_1.default.create({
            baseURL: index_js_1.config.torbox.baseUrl,
            timeout: index_js_1.config.torbox.timeout || 30000,
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });
        client.interceptors.response.use(response => response, (error) => {
            const errorData = error.response?.data;
            const status = error.response?.status;
            const errorMessage = errorData?.detail || errorData?.error || error.message;
            if (status === 503) {
                throw new StreamStatusException_js_1.StreamStatusException(StaticResponseService_js_1.StaticResponse.FAILED_DOWNLOAD, 'error', undefined, 'Torbox indisponível no momento');
            }
            if (status === 401 || status === 403) {
                throw new Error('Torbox authentication failed: Invalid or expired API token');
            }
            throw new Error(`Torbox API Error (${status}): ${errorMessage}`);
        });
        return client;
    }
    async addMagnet(magnetLink, apiKey) {
        this.validateMagnetLink(magnetLink);
        const client = this.createHttpClient(apiKey);
        try {
            const body = new URLSearchParams();
            body.append('magnet', magnetLink);
            const response = await this.retryableRequest(() => client.post('/torrents/createtorrent', body.toString(), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            }), 'addMagnet');
            const torrentId = response.data?.torrent_id || response.data?.id || response.data?.data?.torrent_id || response.data?.data?.id;
            if (torrentId) {
                this.logger.info('Magnet adicionado ao Torbox', { torrentId, magnetHash: await this.extrairMagnetHash(magnetLink) });
                return String(torrentId);
            }
            throw new Error('Formato de resposta inválido do createtorrent: ' + JSON.stringify(response.data));
        }
        catch (error) {
            if (error instanceof StreamStatusException_js_1.StreamStatusException)
                throw error;
            this.logger.error('Falha ao adicionar magnet ao Torbox', {
                error: error instanceof Error ? error.message : 'Erro',
                magnetHash: await this.extrairMagnetHash(magnetLink)
            });
            throw error;
        }
    }
    async getTorrentInfo(torrentId, apiKey) {
        this.validateTorrentId(torrentId);
        const client = this.createHttpClient(apiKey);
        try {
            const response = await this.retryableRequest(() => client.get('/torrents/mylist', { params: { id: torrentId } }), 'getTorrentInfo');
            const data = response.data?.data;
            if (data) {
                if (Array.isArray(data)) {
                    if (data.length === 0)
                        throw new Error('Torrent não encontrado no Torbox');
                    return data[0];
                }
                return data;
            }
            throw new Error('Torrent não encontrado no Torbox');
        }
        catch (error) {
            if (error instanceof StreamStatusException_js_1.StreamStatusException)
                throw error;
            this.logger.error('Falha ao obter info do torrent', { torrentId });
            throw error;
        }
    }
    async selectFiles(_torrentId, _apiKey, _fileIds = 'all') {
    }
    async unrestrictLink(_link, _apiKey) {
        throw new Error('Torbox não suporta unrestrictLink. Use getStreamLinkForFile/getStreamLinkForTorrent.');
    }
    buildStreamPermalink(torrentId, fileId, apiKey) {
        return `https://api.torbox.app/v1/api/torrents/requestdl?token=${encodeURIComponent(apiKey)}&torrent_id=${torrentId}&file_id=${fileId}&redirect=true`;
    }
    async getStreamLinkForFile(torrentId, fileId, apiKey) {
        try {
            const info = await this.getTorrentInfo(torrentId, apiKey);
            const staticResponse = this.staticResponseService.getResponseForTorboxStatus(info.download_state);
            if (staticResponse) {
                throw new StreamStatusException_js_1.StreamStatusException(staticResponse, info.download_state, Math.round(info.progress * 100), `Status: ${info.download_state}`);
            }
            if (!this.isReadyStatus(info.download_state)) {
                throw new StreamStatusException_js_1.StreamStatusException(StaticResponseService_js_1.StaticResponse.DOWNLOADING, info.download_state, Math.round(info.progress * 100), 'Aguardando download');
            }
            const file = (info.files || []).find(f => f.id === fileId);
            if (!file) {
                throw new StreamStatusException_js_1.StreamStatusException(StaticResponseService_js_1.StaticResponse.FAILED_UNEXPECTED, info.download_state, undefined, 'Arquivo não encontrado');
            }
            return this.buildStreamPermalink(torrentId, fileId, apiKey);
        }
        catch (error) {
            if (error instanceof StreamStatusException_js_1.StreamStatusException)
                throw error;
            this.logger.error('Falha ao obter stream para arquivo', { torrentId, fileId });
            return null;
        }
    }
    async getStreamLinkForTorrent(torrentId, apiKey, targetSeason, targetEpisode) {
        this.validateTorrentId(torrentId);
        try {
            const info = await this.getTorrentInfo(torrentId, apiKey);
            const staticResponse = this.staticResponseService.getResponseForTorboxStatus(info.download_state);
            if (staticResponse) {
                throw new StreamStatusException_js_1.StreamStatusException(staticResponse, info.download_state, Math.round(info.progress * 100), `Status: ${info.download_state}`);
            }
            if (!this.isReadyStatus(info.download_state)) {
                throw new StreamStatusException_js_1.StreamStatusException(StaticResponseService_js_1.StaticResponse.DOWNLOADING, info.download_state, Math.round(info.progress * 100), 'Aguardando download');
            }
            const files = info.files || [];
            let bestFile = null;
            let bestScore = 0;
            for (const f of files) {
                if (!this.videoExtensions.some(ext => f.name.toLowerCase().endsWith(ext)))
                    continue;
                let score = f.size;
                if (targetSeason !== undefined && targetEpisode !== undefined) {
                    const { temporada, episodio } = this.extrairTemporadaEpisodio(f.name);
                    if (temporada === targetSeason && episodio === targetEpisode)
                        score += 10000000000;
                }
                if (score > bestScore) {
                    bestScore = score;
                    bestFile = f;
                }
            }
            if (!bestFile) {
                throw new StreamStatusException_js_1.StreamStatusException(StaticResponseService_js_1.StaticResponse.FAILED_RAR, info.download_state, 100, 'Nenhum arquivo de vídeo encontrado');
            }
            return this.buildStreamPermalink(torrentId, bestFile.id, apiKey);
        }
        catch (error) {
            if (error instanceof StreamStatusException_js_1.StreamStatusException)
                throw error;
            this.logger.error('Falha ao obter stream', { torrentId });
            return null;
        }
    }
    async getStreamLinkWithStatus(torrentId, apiKey, targetSeason, targetEpisode) {
        try {
            const info = await this.getTorrentInfo(torrentId, apiKey);
            const sr = this.staticResponseService.getResponseForTorboxStatus(info.download_state);
            if (sr)
                return { url: null, status: info.download_state, staticResponse: sr, progress: Math.round(info.progress * 100) };
            if (this.isReadyStatus(info.download_state)) {
                const link = await this.getStreamLinkForTorrent(torrentId, apiKey, targetSeason, targetEpisode);
                return { url: link, status: 'cached', progress: 100 };
            }
            return { url: null, status: info.download_state, progress: Math.round(info.progress * 100) };
        }
        catch (error) {
            if (error instanceof StreamStatusException_js_1.StreamStatusException) {
                return { url: null, status: 'downloading', staticResponse: error.staticResponse, progress: error.progress };
            }
            return { url: null, status: 'error' };
        }
    }
    async getTorrentFiles(torrentId, apiKey) {
        return (await this.getTorrentInfo(torrentId, apiKey)).files || [];
    }
    async findExistingTorrent(magnetHash, apiKey) {
        const client = this.createHttpClient(apiKey);
        try {
            const response = await this.retryableRequest(() => client.get('/torrents/mylist'), 'findExistingTorrent');
            const list = response.data?.data || [];
            const t = list.find((torrent) => torrent.hash?.toLowerCase() === magnetHash.toLowerCase());
            if (t)
                this.logger.info('Torrent existente encontrado no Torbox', { id: t.id, status: t.download_state });
            return t || null;
        }
        catch (error) {
            if (error instanceof StreamStatusException_js_1.StreamStatusException)
                throw error;
            this.logger.error('Falha ao buscar torrent existente', { magnetHash });
            return null;
        }
    }
    async processTorrent(magnetLink, apiKey) {
        const hash = await this.extrairMagnetHash(magnetLink);
        try {
            const existing = await this.findExistingTorrent(hash, apiKey);
            if (existing) {
                const ready = this.isReadyStatus(existing.download_state);
                return { added: true, ready, status: existing.download_state, torrentId: String(existing.id), progress: Math.round(existing.progress * 100) };
            }
            const id = await this.addMagnet(magnetLink, apiKey);
            const info = await this.getTorrentInfo(id, apiKey);
            const ready = this.isReadyStatus(info.download_state);
            return { added: true, ready, status: info.download_state, torrentId: id, progress: Math.round(info.progress * 100) };
        }
        catch (error) {
            if (error instanceof StreamStatusException_js_1.StreamStatusException)
                throw error;
            return { added: false, ready: false, status: 'error' };
        }
    }
    isReadyStatus(status) {
        const ready = ['completed', 'cached', 'uploading', 'seeding'];
        const s = status?.toLowerCase() || '';
        return ready.includes(s);
    }
    async retryableRequest(requestFn, operation) {
        let lastError;
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                return await requestFn();
            }
            catch (error) {
                lastError = error;
                if (error instanceof StreamStatusException_js_1.StreamStatusException)
                    throw error;
                if (this.isRetryableError(error) && attempt < this.maxRetries) {
                    const delay = this.baseDelay * Math.pow(2, attempt - 1);
                    this.logger.warn(`Tentativa ${attempt}/${this.maxRetries} falhou, retry em ${delay}ms`);
                    await this.delay(delay);
                    continue;
                }
                break;
            }
        }
        throw lastError;
    }
    isRetryableError(error) {
        const status = error.response?.status;
        return status ? [429, 500, 502, 503, 504].includes(status) : !error.response;
    }
    validateMagnetLink(link) {
        if (!link?.startsWith('magnet:?') || !link.includes('xt=urn:btih:')) {
            throw new Error('Magnet link inválido');
        }
    }
    validateTorrentId(id) {
        if (!id?.trim())
            throw new Error('Torrent ID obrigatório');
    }
    async extrairMagnetHash(link) {
        const dados = await (0, magnetHelper_js_1.analisarMagnet)(link);
        return dados ? dados.infoHash : 'unknown';
    }
    extrairTemporadaEpisodio(nomeArquivo) {
        const info = this.episodeMatcher.extractEpisodeInfo(nomeArquivo);
        if (info.season > 0 && info.episode > 0) {
            return { temporada: info.season, episodio: info.episode };
        }
        return {};
    }
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.TorboxService = TorboxService;
