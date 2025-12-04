"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RealDebridService = void 0;
const axios_1 = __importDefault(require("axios"));
const index_1 = require("../config/index");
const logger_1 = require("../utils/logger");
const StaticResponseService_1 = require("./StaticResponseService");
const StreamStatusException_1 = require("./StreamStatusException");
class RealDebridService {
    constructor(baseUrl) {
        this.maxRetries = 3;
        this.baseDelay = 1000;
        this.videoExtensions = [
            '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v',
            '.mpg', '.mpeg', '.3gp', '.ts', '.mts', '.m2ts', '.vob'
        ];
        this.logger = new logger_1.Logger('RealDebridService');
        this.staticResponseService = new StaticResponseService_1.StaticResponseService(baseUrl);
    }
    setStaticResponseBaseUrl(baseUrl) {
        this.staticResponseService.setBaseUrl(baseUrl);
    }
    createHttpClient(apiKey) {
        if (!apiKey || apiKey.trim().length === 0) {
            throw new Error('Real-Debrid API Key is required');
        }
        if (!index_1.config.realDebrid.baseUrl) {
            throw new Error('Real-Debrid base URL is required');
        }
        return axios_1.default.create({
            baseURL: index_1.config.realDebrid.baseUrl,
            timeout: index_1.config.realDebrid.timeout || 30000,
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });
    }
    setupInterceptors(client) {
        client.interceptors.request.use((requestConfig) => {
            return requestConfig;
        }, (error) => {
            this.logger.error('Request configuration error', { error: error.message });
            return Promise.reject(error);
        });
        client.interceptors.response.use((response) => {
            return response;
        }, (error) => {
            const errorData = error.response?.data;
            const statusCode = error.response?.status;
            const errorMessage = errorData?.error || error.message;
            this.logger.error('Real-Debrid API Error', {
                url: error.config?.url,
                method: error.config?.method?.toUpperCase(),
                status: statusCode,
                errorCode: errorData?.error_code,
                errorMessage: errorMessage
            });
            if (statusCode === 401) {
                throw new Error('Real-Debrid authentication failed: Invalid or expired token');
            }
            else if (statusCode === 403) {
                throw new Error('Real-Debrid permission denied: Account locked or insufficient privileges');
            }
            else if (statusCode === 429) {
                throw new Error('Real-Debrid rate limit exceeded: Too many requests');
            }
            else if (statusCode === 503) {
                throw new Error('Real-Debrid service unavailable: Please try again later');
            }
            else if (errorData?.error) {
                throw new Error(`Real-Debrid API Error: ${errorData.error}`);
            }
            else {
                throw new Error(`Real-Debrid network error: ${errorMessage}`);
            }
        });
    }
    async addMagnet(magnetLink, apiKey) {
        this.validateMagnetLink(magnetLink);
        const client = this.createHttpClient(apiKey);
        this.setupInterceptors(client);
        try {
            const response = await this.retryableRequest(() => client.post('/torrents/addMagnet', `magnet=${encodeURIComponent(magnetLink)}`, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }), 'addMagnet');
            if (response.status === 201 && response.data.id) {
                this.logger.info('Magnet link added successfully', {
                    torrentId: response.data.id,
                    magnetHash: this.extractMagnetHash(magnetLink)
                });
                return response.data.id;
            }
            else {
                throw new Error('Invalid response format from addMagnet endpoint');
            }
        }
        catch (error) {
            this.logger.error('Failed to add magnet link', {
                error: this.getErrorMessage(error),
                magnetHash: this.extractMagnetHash(magnetLink)
            });
            throw error;
        }
    }
    async getTorrentInfo(torrentId, apiKey) {
        this.validateTorrentId(torrentId);
        const client = this.createHttpClient(apiKey);
        this.setupInterceptors(client);
        try {
            const response = await this.retryableRequest(() => client.get(`/torrents/info/${torrentId}`), 'getTorrentInfo');
            return response.data;
        }
        catch (error) {
            this.logger.error('Failed to get torrent information', {
                torrentId,
                error: this.getErrorMessage(error)
            });
            throw error;
        }
    }
    async selectFiles(torrentId, apiKey, fileIds = 'all') {
        this.validateTorrentId(torrentId);
        const client = this.createHttpClient(apiKey);
        this.setupInterceptors(client);
        try {
            const response = await this.retryableRequest(() => client.post(`/torrents/selectFiles/${torrentId}`, `files=${fileIds}`, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }), 'selectFiles');
            if (response.status === 204 || response.status === 202) {
            }
            else {
                throw new Error(`Unexpected response status: ${response.status}`);
            }
        }
        catch (error) {
            this.logger.error('Failed to select files', {
                torrentId,
                fileIds,
                error: this.getErrorMessage(error)
            });
            throw error;
        }
    }
    async unrestrictLink(link, apiKey) {
        if (!link || link.trim().length === 0) {
            throw new Error('Link cannot be empty');
        }
        const client = this.createHttpClient(apiKey);
        this.setupInterceptors(client);
        try {
            const response = await this.retryableRequest(() => client.post('/unrestrict/link', `link=${encodeURIComponent(link)}`, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }), 'unrestrictLink');
            if (response.data.download) {
                return response.data.download;
            }
            else {
                throw new Error('No download link returned from unrestrict endpoint');
            }
        }
        catch (error) {
            this.logger.error('Link unrestrict failed', {
                error: this.getErrorMessage(error),
                link: this.sanitizeLink(link)
            });
            throw error;
        }
    }
    async getStreamLinkForFile(torrentId, fileId, apiKey) {
        this.validateTorrentId(torrentId);
        try {
            const torrentInfo = await this.getTorrentInfo(torrentId, apiKey);
            const staticResponse = this.staticResponseService.getResponseForRealDebridStatus(torrentInfo.status);
            if (staticResponse && staticResponse === StaticResponseService_1.StaticResponse.DOWNLOADING) {
                throw new StreamStatusException_1.StreamStatusException(staticResponse, torrentInfo.status, torrentInfo.progress, `Torrent está em estado: ${torrentInfo.status}`);
            }
            if (torrentInfo.status !== 'downloaded') {
                return null;
            }
            if (!torrentInfo.links || torrentInfo.links.length === 0) {
                return null;
            }
            const selectedFiles = torrentInfo.files?.filter(file => file.selected === 1) || [];
            const fileIndex = selectedFiles.findIndex(file => file.id === fileId);
            if (fileIndex === -1 || fileIndex >= torrentInfo.links.length) {
                return null;
            }
            const rdLink = torrentInfo.links[fileIndex];
            const directLink = await this.unrestrictLink(rdLink, apiKey);
            return directLink;
        }
        catch (error) {
            this.logger.error('Failed to get stream link for file', {
                torrentId,
                fileId,
                error: this.getErrorMessage(error)
            });
            return null;
        }
    }
    async getStreamLinkForTorrent(torrentId, apiKey, targetSeason, targetEpisode) {
        this.validateTorrentId(torrentId);
        try {
            this.logger.info('Iniciando seleção de arquivo', {
                torrentId,
                targetSeason,
                targetEpisode
            });
            const torrentInfo = await this.getTorrentInfo(torrentId, apiKey);
            const staticResponse = this.staticResponseService.getResponseForRealDebridStatus(torrentInfo.status);
            if (staticResponse) {
                this.logger.info('Lançando StreamStatusException', {
                    torrentId,
                    rdStatus: torrentInfo.status,
                    staticResponse,
                    progress: torrentInfo.progress
                });
                throw new StreamStatusException_1.StreamStatusException(staticResponse, torrentInfo.status, torrentInfo.progress, `Torrent está em estado: ${torrentInfo.status}`);
            }
            if (torrentInfo.status !== 'downloaded') {
                this.logger.warn('Torrent não está baixado', {
                    torrentId,
                    status: torrentInfo.status
                });
                return null;
            }
            if (!torrentInfo.links || torrentInfo.links.length === 0) {
                this.logger.warn('Nenhum link disponível', { torrentId });
                return null;
            }
            const files = torrentInfo.files || [];
            const selectedFiles = files.filter(file => file.selected === 1);
            if (selectedFiles.length === 0) {
                this.logger.warn('Nenhum arquivo selecionado', { torrentId });
                return null;
            }
            let bestFileIndex = -1;
            let bestScore = 0;
            for (let i = 0; i < selectedFiles.length; i++) {
                const file = selectedFiles[i];
                const fileName = file.path.toLowerCase();
                const isVideo = this.videoExtensions.some(ext => fileName.endsWith(ext));
                if (!isVideo)
                    continue;
                let score = file.bytes;
                if (targetSeason !== undefined && targetEpisode !== undefined) {
                    const fileSeason = this.extractSeasonFromFileName(file.path);
                    const fileEpisode = this.extractEpisodeFromFileName(file.path);
                    if (fileSeason === targetSeason && fileEpisode === targetEpisode) {
                        score += 10000000000;
                    }
                }
                if (score > bestScore) {
                    bestScore = score;
                    bestFileIndex = i;
                }
            }
            if (bestFileIndex === -1) {
                bestFileIndex = 0;
            }
            if (bestFileIndex >= torrentInfo.links.length) {
                bestFileIndex = 0;
            }
            const selectedLink = torrentInfo.links[bestFileIndex];
            const directLink = await this.unrestrictLink(selectedLink, apiKey);
            this.logger.info('Stream link obtido com sucesso', {
                torrentId,
                fileName: selectedFiles[bestFileIndex]?.path || 'Desconhecido'
            });
            return directLink;
        }
        catch (error) {
            if (error instanceof StreamStatusException_1.StreamStatusException) {
                throw error;
            }
            const axiosError = error;
            const errorData = axiosError.response?.data;
            const errorCode = errorData?.error_code;
            const staticResponse = this.staticResponseService.getResponseForRealDebridStatus('error', errorCode);
            if (staticResponse) {
                throw new StreamStatusException_1.StreamStatusException(staticResponse, 'error', undefined, `Erro Real-Debrid: ${this.getErrorMessage(error)}`);
            }
            this.logger.error('Falha ao obter stream link', {
                torrentId,
                error: this.getErrorMessage(error)
            });
            return null;
        }
    }
    async getStreamLinkWithStatus(torrentId, apiKey, targetSeason, targetEpisode) {
        try {
            const torrentInfo = await this.getTorrentInfo(torrentId, apiKey);
            const staticResponse = this.staticResponseService.getResponseForRealDebridStatus(torrentInfo.status);
            if (staticResponse) {
                return {
                    url: null,
                    status: this.mapRdStatusToStreamStatus(torrentInfo.status),
                    staticResponse,
                    progress: torrentInfo.progress
                };
            }
            if (torrentInfo.status === 'downloaded' && torrentInfo.links && torrentInfo.links.length > 0) {
                const link = await this.getStreamLinkForTorrent(torrentId, apiKey, targetSeason, targetEpisode);
                return {
                    url: link,
                    status: 'downloaded',
                    progress: 100
                };
            }
            return {
                url: null,
                status: this.mapRdStatusToStreamStatus(torrentInfo.status),
                progress: torrentInfo.progress
            };
        }
        catch (error) {
            if (error instanceof StreamStatusException_1.StreamStatusException) {
                return {
                    url: null,
                    status: 'downloading',
                    staticResponse: error.staticResponse,
                    progress: error.progress
                };
            }
            return {
                url: null,
                status: 'error'
            };
        }
    }
    mapRdStatusToStreamStatus(rdStatus) {
        const statusMap = {
            'downloaded': 'downloaded',
            'dead': 'downloaded',
            'downloading': 'downloading',
            'uploading': 'downloading',
            'queued': 'downloading',
            'magnet_conversion': 'downloading',
            'waiting_files_selection': 'waiting',
            'error': 'error',
            'magnet_error': 'error'
        };
        return statusMap[rdStatus] || 'unknown';
    }
    extractSeasonFromFileName(fileName) {
        const lowerName = fileName.toLowerCase();
        const patterns = [
            /s(\d+)e\d+/i,
            /season\s*(\d+)\s*episode/i,
            /(\d+)x\d+/i
        ];
        for (const pattern of patterns) {
            const match = lowerName.match(pattern);
            if (match && match[1]) {
                return parseInt(match[1], 10);
            }
        }
        return undefined;
    }
    extractEpisodeFromFileName(fileName) {
        const lowerName = fileName.toLowerCase();
        const patterns = [
            /s\d+e(\d+)/i,
            /season\s*\d+\s*episode\s*(\d+)/i,
            /\d+x(\d+)/i,
            /ep\s*(\d+)/i
        ];
        for (const pattern of patterns) {
            const match = lowerName.match(pattern);
            if (match && match[1]) {
                return parseInt(match[1], 10);
            }
        }
        return undefined;
    }
    async getTorrentFiles(torrentId, apiKey) {
        const torrentInfo = await this.getTorrentInfo(torrentId, apiKey);
        return torrentInfo.files || [];
    }
    async findExistingTorrent(magnetHash, apiKey) {
        const client = this.createHttpClient(apiKey);
        this.setupInterceptors(client);
        try {
            const response = await this.retryableRequest(() => client.get('/torrents', {
                params: { limit: 5000 }
            }), 'findExistingTorrent');
            const torrents = response.data;
            const existingTorrent = torrents.find(torrent => torrent.hash?.toLowerCase() === magnetHash.toLowerCase());
            if (existingTorrent) {
                this.logger.info('Existing torrent found', {
                    torrentId: existingTorrent.id,
                    magnetHash,
                    status: existingTorrent.status,
                    progress: existingTorrent.progress
                });
                return existingTorrent;
            }
            return null;
        }
        catch (error) {
            this.logger.error('Failed to find existing torrent', {
                magnetHash,
                error: this.getErrorMessage(error)
            });
            return null;
        }
    }
    async processTorrent(magnetLink, apiKey) {
        const magnetHash = this.extractMagnetHash(magnetLink);
        try {
            const existingTorrent = await this.findExistingTorrent(magnetHash, apiKey);
            if (existingTorrent) {
                return {
                    added: true,
                    ready: existingTorrent.status === 'downloaded',
                    status: existingTorrent.status,
                    torrentId: existingTorrent.id,
                    progress: existingTorrent.progress
                };
            }
            const torrentId = await this.addMagnet(magnetLink, apiKey);
            await this.selectFiles(torrentId, apiKey, 'all');
            const torrentInfo = await this.getTorrentInfo(torrentId, apiKey);
            return {
                added: true,
                ready: torrentInfo.status === 'downloaded',
                status: torrentInfo.status,
                torrentId: torrentId,
                progress: torrentInfo.progress
            };
        }
        catch (error) {
            this.logger.error('Failed to process torrent', {
                magnetHash,
                error: this.getErrorMessage(error)
            });
            return {
                added: false,
                ready: false,
                status: 'error'
            };
        }
    }
    async retryableRequest(requestFn, operation) {
        let lastError;
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const response = await requestFn();
                return response;
            }
            catch (error) {
                lastError = error;
                if (this.isRetryableError(error) && attempt < this.maxRetries) {
                    const delayMs = this.baseDelay * Math.pow(2, attempt - 1);
                    this.logger.warn(`Retrying request after error`, {
                        operation,
                        attempt,
                        maxAttempts: this.maxRetries,
                        delayMs,
                        error: this.getErrorMessage(error)
                    });
                    await this.delay(delayMs);
                    continue;
                }
                break;
            }
        }
        throw lastError;
    }
    isRetryableError(error) {
        const status = error.response?.status;
        const code = error.code;
        if (status && [429, 500, 502, 503, 504].includes(status)) {
            return true;
        }
        if (code && ['ECONNABORTED', 'ETIMEDOUT', 'ENOTFOUND'].includes(code)) {
            return true;
        }
        return !error.response;
    }
    validateMagnetLink(magnetLink) {
        if (!magnetLink) {
            throw new Error('Magnet link is required');
        }
        if (!magnetLink.startsWith('magnet:?')) {
            throw new Error('Invalid magnet link format: must start with "magnet:?"');
        }
        if (!magnetLink.includes('xt=urn:btih:')) {
            throw new Error('Magnet link does not contain valid info hash');
        }
    }
    validateTorrentId(torrentId) {
        if (!torrentId || torrentId.trim().length === 0) {
            throw new Error('Torrent ID is required');
        }
    }
    extractMagnetHash(magnetLink) {
        const match = magnetLink.match(/btih:([a-zA-Z0-9]+)/i);
        return match ? match[1].toLowerCase() : 'unknown';
    }
    sanitizeLink(link) {
        if (link.length <= 50)
            return link;
        return link.substring(0, 47) + '...';
    }
    getErrorMessage(error) {
        if (error instanceof Error) {
            return error.message;
        }
        return String(error);
    }
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.RealDebridService = RealDebridService;
