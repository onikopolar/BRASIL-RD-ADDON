"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TorboxService = void 0;
const axios_1 = __importDefault(require("axios"));
const index_js_1 = require("../config/index.js");
const logger_js_1 = require("../utils/logger.js");
const StaticResponseService_js_1 = require("../stream/StaticResponseService.js");
const StreamStatusException_js_1 = require("../stream/StreamStatusException.js");
const episodeMatcher_js_1 = require("../titulos/episodeMatcher.js");
const magnetHelper_js_1 = require("../magnet/magnetHelper.js");
const TechnicalWords_js_1 = require("../titulos/TechnicalWords.js");
const qualityDetector_js_1 = require("../lib/qualityDetector.js");
class TorboxService {
    static getInstance(baseUrl) {
        if (!TorboxService.instance) {
            TorboxService.instance = new TorboxService(baseUrl);
        }
        else if (baseUrl) {
            TorboxService.instance.staticResponseService.setBaseUrl(baseUrl);
        }
        return TorboxService.instance;
    }
    constructor(baseUrl) {
        this.maxRetries = 3;
        this.baseDelay = 1000;
        this.videoExtensions = [
            '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v',
            '.mpg', '.mpeg', '.3gp', '.ts', '.mts', '.m2ts', '.vob'
        ];
        this.episodeMatcher = episodeMatcher_js_1.EpisodeMatcher.getInstance();
        this.qualityDetector = qualityDetector_js_1.QualityDetector.getInstance();
        this.titleCache = new Map();
        this.logger = new logger_js_1.Logger('TorboxService');
        this.staticResponseService = new StaticResponseService_js_1.StaticResponseService(baseUrl);
    }
    setStaticResponseBaseUrl(baseUrl) {
        this.staticResponseService.setBaseUrl(baseUrl);
    }
    setTitlesForHash(infoHash, titles) {
        if (infoHash && titles.length > 0) {
            const uniqueTitles = Array.from(new Set(titles));
            this.titleCache.set(infoHash.toLowerCase(), uniqueTitles);
            this.logger.debug('Títulos registrados para seleção de arquivo (únicos)', {
                infoHash: infoHash.toLowerCase(),
                titles: uniqueTitles,
            });
        }
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
        const dadosMagnet = await (0, magnetHelper_js_1.analisarMagnet)(magnetLink);
        const hash = dadosMagnet?.infoHash?.toLowerCase() || 'unknown';
        const nome = dadosMagnet?.nome || this.titleCache.get(hash)?.[0] || '';
        this.logger.debug('addMagnet: início', { magnetHash: hash, nome });
        try {
            const body = new URLSearchParams();
            body.append('magnet', magnetLink);
            if (nome) {
                body.append('name', nome);
            }
            const response = await this.retryableRequest(() => client.post('/torrents/createtorrent', body.toString(), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            }), 'addMagnet');
            const torrentId = response.data?.torrent_id
                || response.data?.id
                || response.data?.data?.torrent_id
                || response.data?.data?.id
                || response.data?.data?.queued_id;
            this.logger.debug('addMagnet: resposta recebida', { responseData: response.data, torrentId });
            if (torrentId) {
                if (hash !== 'unknown') {
                    TorboxService.queuedTorrentCache.set(hash, String(torrentId));
                }
                this.logger.info('Magnet adicionado ao Torbox', {
                    torrentId,
                    magnetHash: hash,
                    nomeMagnet: nome?.substring(0, 80) || 'N/A',
                    campoEncontrado: response.data?.torrent_id ? 'torrent_id' :
                        response.data?.id ? 'id' :
                            response.data?.data?.torrent_id ? 'data.torrent_id' :
                                response.data?.data?.id ? 'data.id' : 'data.queued_id'
                });
                return String(torrentId);
            }
            throw new Error('Formato de resposta inválido do createtorrent: ' + JSON.stringify(response.data));
        }
        catch (error) {
            if (error instanceof StreamStatusException_js_1.StreamStatusException)
                throw error;
            const msg = error instanceof Error ? error.message : '';
            if (/already queued/i.test(msg)) {
                const cachedId = hash !== 'unknown' ? TorboxService.queuedTorrentCache.get(hash) : undefined;
                if (cachedId) {
                    this.logger.info('Magnet já na fila, usando ID cacheado', {
                        torrentId: cachedId,
                        magnetHash: hash?.substring(0, 16),
                    });
                    return cachedId;
                }
            }
            this.logger.error('Falha ao adicionar magnet ao Torbox', {
                error: msg || 'Erro',
                magnetHash: hash,
            });
            throw error;
        }
    }
    async airlockTorrent(torrentId, apiKey, enabled) {
        const client = this.createHttpClient(apiKey);
        this.logger.debug('airlockTorrent: início', { torrentId, enabled });
        try {
            await this.retryableRequest(() => client.put('/torrents/edittorrent', {
                torrent_id: parseInt(torrentId),
                airlocked: enabled
            }), 'airlockTorrent');
            this.logger.info(`AirLock ${enabled ? 'ATIVADO' : 'DESATIVADO'}`, { torrentId });
        }
        catch (error) {
            this.logger.warn('Falha ao configurar AirLock', {
                torrentId,
                error: error.message
            });
        }
    }
    async getTorrentInfo(torrentId, apiKey) {
        this.validateTorrentId(torrentId);
        const client = this.createHttpClient(apiKey);
        this.logger.debug('getTorrentInfo: início', { torrentId });
        try {
            const response = await this.retryableRequest(() => client.get('/torrents/mylist', { params: { id: torrentId } }), 'getTorrentInfo');
            const data = response.data?.data;
            if (data) {
                if (Array.isArray(data)) {
                    if (data.length === 0)
                        throw new Error('Torrent não encontrado no Torbox');
                    this.logger.debug('getTorrentInfo: retornou array, primeiro item', { torrent: data[0] });
                    return data[0];
                }
                this.logger.debug('getTorrentInfo: retornou objeto', { torrent: data });
                return data;
            }
            throw new Error('Torrent não encontrado no Torbox');
        }
        catch (error) {
            if (error instanceof StreamStatusException_js_1.StreamStatusException)
                throw error;
            this.logger.error('Falha ao obter info do torrent', { torrentId, message: error.message });
            throw error;
        }
    }
    async getTorrentInfoByHash(hash, apiKey, timeoutSec = 10) {
        if (!hash || hash.length < 32)
            return 0;
        const client = this.createHttpClient(apiKey);
        const startTime = Date.now();
        try {
            const response = await client.get('/torrents/torrentinfo', {
                params: { hash, timeout: timeoutSec },
                timeout: (timeoutSec + 2) * 1000,
            });
            const seeds = Number(response.data?.data?.seeds);
            const durationMs = Date.now() - startTime;
            if (!Number.isFinite(seeds) || seeds < 0) {
                this.logger.debug('getTorrentInfoByHash: seeds inválidos na resposta', {
                    hash: hash.substring(0, 16),
                    rawSeeds: response.data?.data?.seeds,
                    durationMs,
                });
                return 0;
            }
            this.logger.debug('getTorrentInfoByHash: seeds obtidos', {
                hash: hash.substring(0, 16),
                seeds,
                durationMs,
            });
            return seeds;
        }
        catch (error) {
            this.logger.debug('getTorrentInfoByHash: falha silenciosa (retorna 0)', {
                hash: hash.substring(0, 16),
                error: error.message,
                durationMs: Date.now() - startTime,
            });
            return 0;
        }
    }
    async selectFiles(_torrentId, _apiKey, _fileIds = 'all') {
        this.logger.debug('selectFiles: método não suportado (noop)');
    }
    async unrestrictLink(_link, _apiKey) {
        throw new Error('Torbox não suporta unrestrictLink. Use getStreamLinkForTorrent.');
    }
    buildStreamPermalink(torrentId, fileId, apiKey) {
        const url = `https://api.torbox.app/v1/api/torrents/requestdl?token=${encodeURIComponent(apiKey)}&torrent_id=${torrentId}&file_id=${fileId}&redirect=true`;
        this.logger.debug('buildStreamPermalink', { torrentId, fileId, url });
        return url;
    }
    async getStreamLinkForTorrent(torrentId, apiKey, targetSeason, targetEpisode, targetQuality, cachedInfo, targetTitles, episodeTitles) {
        this.logger.info('getStreamLinkForTorrent: início', {
            torrentId,
            targetSeason,
            targetEpisode,
            targetQuality,
            hasCachedInfo: !!cachedInfo,
            targetTitles: targetTitles || 'não informado',
            episodeTitles: episodeTitles ? episodeTitles.length : 'não informado'
        });
        try {
            const info = cachedInfo || await this.getTorrentInfo(torrentId, apiKey);
            this.logger.debug('getStreamLinkForTorrent: informações do torrent', {
                hash: info.hash,
                name: info.name,
                download_state: info.download_state,
                progress: info.progress,
                fileCount: info.files?.length
            });
            const staticResponse = this.staticResponseService.getResponseForTorboxStatus(info.download_state);
            if (staticResponse) {
                this.logger.debug('getStreamLinkForTorrent: status não ready', { status: info.download_state, staticResponse });
                throw new StreamStatusException_js_1.StreamStatusException(staticResponse, info.download_state, Math.round(info.progress * 100), `Status: ${info.download_state}`);
            }
            if (!this.isReadyStatus(info.download_state)) {
                this.logger.debug('getStreamLinkForTorrent: ainda baixando', { status: info.download_state, progress: info.progress });
                throw new StreamStatusException_js_1.StreamStatusException(StaticResponseService_js_1.StaticResponse.DOWNLOADING, info.download_state, Math.round(info.progress * 100), 'Aguardando download');
            }
            const files = info.files || [];
            const minSize = (targetSeason !== undefined) ? 5 * 1024 * 1024 : 10 * 1024 * 1024;
            this.logger.debug('getStreamLinkForTorrent: filtro de candidatos', {
                totalFiles: files.length,
                minSize,
                targetSeason,
                targetEpisode
            });
            let candidateFiles = files.filter(f => this.videoExtensions.some(ext => f.name.toLowerCase().endsWith(ext)) &&
                f.size >= minSize);
            this.logger.debug('getStreamLinkForTorrent: após filtro de extensão/tamanho', {
                candidateCount: candidateFiles.length,
                candidates: candidateFiles.map(f => f.name)
            });
            if (targetSeason !== undefined && targetEpisode !== undefined) {
                const epData = episodeTitles?.find(ep => ep.episodeNumber === targetEpisode);
                const statusEp = !episodeTitles ? 'AUSENTE' : (episodeTitles.length === 0 ? 'VAZIO' : `${episodeTitles.length} eps`);
                this.logger.info('🎯 Episódio alvo', {
                    alvo: `${targetSeason}x${targetEpisode}`,
                    episodeTitles: statusEp,
                    namePt: epData?.namePt || '-',
                    nameEn: epData?.nameEn || '-',
                });
                const episodeFiles = candidateFiles.filter(f => this.episodeMatcher.arquivoPertenceAoEpisodioComTitulos(f.name, targetSeason, targetEpisode, episodeTitles));
                this.logger.info('📁 Filtro episódio', {
                    alvo: `${targetSeason}x${targetEpisode}`,
                    antes: candidateFiles.length,
                    depois: episodeFiles.length,
                    match: episodeFiles.map(f => f.name.split(/[\\/]/).pop()).slice(0, 5),
                });
                if (episodeFiles.length === 0) {
                    this.logger.warn('❌ Nenhum arquivo pro episódio', {
                        alvo: `${targetSeason}x${targetEpisode}`,
                        candidatos: candidateFiles.map(f => f.name.split(/[\\/]/).pop()).slice(0, 10),
                    });
                    throw new StreamStatusException_js_1.StreamStatusException(StaticResponseService_js_1.StaticResponse.FAILED_UNEXPECTED, info.download_state, 100, `Nenhum arquivo do episódio ${targetSeason}x${targetEpisode} encontrado no torrent`);
                }
                candidateFiles = episodeFiles;
            }
            if (!targetTitles || targetTitles.length === 0) {
                const hash = info.hash?.toLowerCase();
                if (hash && this.titleCache.has(hash)) {
                    targetTitles = this.titleCache.get(hash);
                    this.logger.debug('Títulos recuperados do cache para seleção de arquivo', {
                        hash,
                        titles: targetTitles,
                    });
                }
            }
            else {
                targetTitles = Array.from(new Set(targetTitles));
                this.logger.debug('Títulos alvo fornecidos diretamente (únicos)', { targetTitles });
            }
            let bestFile = null;
            let bestScore = 0;
            const scoresLog = [];
            this.logger.debug(`Selecionando arquivo (candidatos: ${candidateFiles.length}, episódio: ${targetSeason}x${targetEpisode})`);
            for (const f of candidateFiles) {
                this.logger.debug('── Avaliando candidato ──', { fileName: f.name, size: f.size });
                let score = 0;
                let titleScore = 0;
                let qualityScore = 0;
                if (targetTitles && targetTitles.length > 0) {
                    titleScore = this.calculateTitleMatchScore(f.name, targetTitles);
                    this.logger.debug('   titleScore calculado:', { titleScore });
                    if (titleScore === -1) {
                        this.logger.debug('   Ano divergente, descartando arquivo');
                        continue;
                    }
                    score += titleScore * 50000000000;
                    this.logger.debug('   score após titleScore * 50B:', { score });
                }
                else {
                    this.logger.debug('   Nenhum título alvo fornecido, titleScore = 0');
                }
                if (targetQuality) {
                    const fileQuality = this.qualityDetector.extractQualityOrNull(f.name);
                    this.logger.debug('   Qualidade extraída do arquivo:', { fileQuality });
                    if (fileQuality) {
                        const normalizedTarget = this.normalizeQuality(targetQuality);
                        const normalizedFile = this.normalizeQuality(fileQuality);
                        this.logger.debug('   Qualidades normalizadas:', { target: normalizedTarget, file: normalizedFile });
                        if (normalizedFile === normalizedTarget) {
                            qualityScore = 100000000000;
                            this.logger.debug('   Qualidade exata, qualityScore = 100B');
                        }
                        else {
                            const qualityRank = ['2160p', '1080p', '720p', '480p'];
                            const targetRank = qualityRank.indexOf(normalizedTarget);
                            const fileRank = qualityRank.indexOf(normalizedFile);
                            this.logger.debug('   Ranks de qualidade:', { targetRank, fileRank });
                            if (targetRank !== -1 && fileRank !== -1) {
                                const diff = Math.abs(targetRank - fileRank);
                                if (fileRank < targetRank) {
                                    qualityScore = 80000000000 - diff * 10000000000;
                                    this.logger.debug('   Qualidade superior à alvo, qualityScore:', { qualityScore });
                                }
                                else {
                                    qualityScore = Math.max(0, 30000000000 - diff * 15000000000);
                                    this.logger.debug('   Qualidade inferior à alvo, qualityScore:', { qualityScore });
                                }
                            }
                        }
                    }
                    else {
                        qualityScore = 5000000000;
                        this.logger.debug('   Qualidade não identificada, qualityScore = 5B');
                    }
                    score += qualityScore;
                    this.logger.debug('   score após qualityScore:', { score });
                }
                else {
                    this.logger.debug('   Nenhuma qualidade alvo fornecida');
                }
                score += f.size;
                this.logger.debug('   score final (com tamanho):', { finalScore: score, size: f.size });
                scoresLog.push({
                    fileName: f.name,
                    titleScore,
                    qualityScore,
                    size: f.size,
                    totalScore: score
                });
                if (score > bestScore) {
                    this.logger.debug('   Novo melhor candidato!', { score, previousBest: bestScore });
                    bestScore = score;
                    bestFile = f;
                }
            }
            this.logger.info('Resumo da avaliação de candidatos', {
                scores: scoresLog,
                bestFile: bestFile?.name,
                bestScore: bestScore
            });
            this.logger.debug('Arquivo escolhido detalhado', {
                name: bestFile?.name,
                score: bestScore,
                segments: bestFile?.name.split(/[\\/]/).filter(Boolean),
            });
            if (!bestFile) {
                this.logger.error('Nenhum arquivo de vídeo encontrado após avaliação');
                throw new StreamStatusException_js_1.StreamStatusException(StaticResponseService_js_1.StaticResponse.FAILED_RAR, info.download_state, 100, 'Nenhum arquivo de vídeo encontrado');
            }
            const link = this.buildStreamPermalink(torrentId, bestFile.id, apiKey);
            this.logger.info('Link de stream gerado', { torrentId, fileId: bestFile.id, link });
            return link;
        }
        catch (error) {
            if (error instanceof StreamStatusException_js_1.StreamStatusException)
                throw error;
            this.logger.error('Falha ao obter stream', { torrentId, error: error.message });
            return null;
        }
    }
    async getTorrentFiles(torrentId, apiKey) {
        this.logger.debug('getTorrentFiles: início', { torrentId });
        return (await this.getTorrentInfo(torrentId, apiKey)).files || [];
    }
    async findExistingTorrent(magnetHash, apiKey) {
        const client = this.createHttpClient(apiKey);
        this.logger.debug('findExistingTorrent: início', { magnetHash: magnetHash.substring(0, 16) });
        try {
            const response = await this.retryableRequest(() => client.get('/torrents/mylist'), 'findExistingTorrent');
            const list = response.data?.data || [];
            this.logger.debug('findExistingTorrent: lista recebida', { count: list.length });
            const t = list.find((torrent) => torrent.hash?.toLowerCase() === magnetHash.toLowerCase());
            if (t)
                this.logger.info('Torrent existente encontrado no Torbox', { id: t.id, status: t.download_state });
            else
                this.logger.debug('Torrent não encontrado na lista');
            return t || null;
        }
        catch (error) {
            if (error instanceof StreamStatusException_js_1.StreamStatusException)
                throw error;
            this.logger.error('Falha ao buscar torrent existente', { magnetHash: magnetHash.substring(0, 16), error: error.message });
            return null;
        }
    }
    async processTorrent(magnetLink, apiKey) {
        const hash = await this.extrairMagnetHash(magnetLink);
        const hashLower = hash.toLowerCase();
        this.logger.debug('processTorrent: início', { magnetHash: hashLower.substring(0, 16) });
        try {
            const cachedId = hash !== 'unknown' ? TorboxService.queuedTorrentCache.get(hashLower) : undefined;
            if (cachedId) {
                this.logger.debug('processTorrent: ID cacheado encontrado', { torrentId: cachedId });
                try {
                    const info = await this.getTorrentInfo(cachedId, apiKey);
                    const ready = this.isReadyStatus(info.download_state);
                    this.logger.info('Usando torrent cacheado', { torrentId: cachedId, status: info.download_state, ready });
                    return { added: true, ready, status: info.download_state, torrentId: cachedId, progress: Math.round(info.progress * 100), info };
                }
                catch (err) {
                    this.logger.warn('Falha ao obter info do cache, tentando adicionar novamente', { torrentId: cachedId, error: err.message });
                }
            }
            this.logger.debug('processTorrent: adicionando magnet');
            const id = await this.addMagnet(magnetLink, apiKey);
            try {
                const info = await this.getTorrentInfo(id, apiKey);
                const ready = this.isReadyStatus(info.download_state);
                this.logger.info('Magnet processado e info obtida', { torrentId: id, status: info.download_state, ready });
                return { added: true, ready, status: info.download_state, torrentId: id, progress: Math.round(info.progress * 100), info };
            }
            catch (infoErr) {
                this.logger.warn('getTorrentInfo falhou, torrent provavelmente em fila', {
                    torrentId: id,
                    error: infoErr instanceof Error ? infoErr.message : 'Erro',
                });
                return { added: true, ready: false, status: 'downloading', torrentId: id, progress: 0 };
            }
        }
        catch (error) {
            if (error instanceof StreamStatusException_js_1.StreamStatusException)
                throw error;
            this.logger.error('processTorrent: erro geral', { magnetHash: hashLower.substring(0, 16), error: error.message });
            return { added: false, ready: false, status: 'error' };
        }
    }
    calculateTitleMatchScore(fileName, targetTitles) {
        this.logger.debug('── calculateTitleMatchScore ──', { fileName, targetTitles });
        const segments = fileName.split(/[\\/]/).filter(s => s.trim().length > 0);
        const basename = segments.length > 0 ? segments[segments.length - 1] : fileName;
        this.logger.debug('   Segmentos do caminho:', { segments });
        let bestSegment = null;
        let bestSegmentScore = -1;
        let bestSegmentDetails = null;
        const tokenize = (texto) => {
            const normalized = (0, TechnicalWords_js_1.normalizarTexto)(texto);
            return normalized
                .split(' ')
                .filter(w => w.length > 2 || /^\d+$/.test(w));
        };
        for (let i = segments.length - 1; i >= 0; i--) {
            const seg = segments[i];
            this.logger.debug(`   Avaliando segmento [índice ${i}]: "${seg}"`);
            const segNormalized = (0, TechnicalWords_js_1.normalizarTexto)(seg);
            const segYears = (0, TechnicalWords_js_1.extrairAno)(seg) || [];
            const segTokens = tokenize(seg);
            this.logger.debug(`      Normalizado: "${segNormalized}", anos: [${segYears.join(', ')}], tokens: [${segTokens.join(', ')}]`);
            for (const title of targetTitles) {
                const titleNormalized = (0, TechnicalWords_js_1.normalizarTexto)(title);
                const titleYears = (0, TechnicalWords_js_1.extrairAno)(title) || [];
                const titleTokens = tokenize(title);
                this.logger.debug(`      Comparando com título alvo: "${title}" (normalizado: "${titleNormalized}", anos: [${titleYears.join(', ')}], tokens: [${titleTokens.join(', ')}])`);
                let wordScore = 0;
                const matchedWords = [];
                for (const tt of titleTokens) {
                    if (segTokens.includes(tt)) {
                        wordScore++;
                        matchedWords.push(tt);
                    }
                }
                this.logger.debug(`         wordScore: ${wordScore} (tokens correspondentes exatos: ${matchedWords.join(', ')})`);
                let yearBonus = 0;
                if (segYears.length > 0 && titleYears.length > 0) {
                    const hasCommonYear = titleYears.some(ty => segYears.includes(ty));
                    if (!hasCommonYear) {
                        this.logger.debug(`         Anos divergentes (segmento: [${segYears.join(', ')}], título: [${titleYears.join(', ')}]), ignorando segmento`);
                        continue;
                    }
                    yearBonus = 100;
                }
                const depthBonus = (i === segments.length - 1) ? 1000 : (i + 1) * 10;
                const total = wordScore * 1000 + depthBonus + yearBonus;
                this.logger.debug(`         depthBonus: ${depthBonus}, yearBonus: ${yearBonus}, score parcial: ${total}`);
                if (total > bestSegmentScore) {
                    bestSegmentScore = total;
                    bestSegment = seg;
                    bestSegmentDetails = {
                        segment: seg,
                        wordScore,
                        depthBonus,
                        yearBonus,
                        total,
                        matchedWords,
                        title,
                        segYears,
                        titleYears,
                    };
                }
            }
        }
        if (!bestSegment) {
            this.logger.debug('   Nenhum segmento adequado, usando fallback no basename');
            bestSegment = basename;
            const fileTokens = tokenize(bestSegment);
            const fileYears = (0, TechnicalWords_js_1.extrairAno)(bestSegment) || [];
            let maxScore = 0;
            for (const title of targetTitles) {
                const titleYears = (0, TechnicalWords_js_1.extrairAno)(title) || [];
                if (fileYears.length > 0 && titleYears.length > 0) {
                    const hasCommonYear = titleYears.some(ty => fileYears.includes(ty));
                    if (!hasCommonYear) {
                        this.logger.debug(`      Título "${title}" ignorado por ano divergente no fallback`);
                        continue;
                    }
                }
                const titleTokens = tokenize(title);
                let score = 0;
                for (const tt of titleTokens) {
                    if (fileTokens.includes(tt))
                        score++;
                }
                if (score > maxScore) {
                    maxScore = score;
                    this.logger.debug(`      Título "${title}" obteve score ${score} no fallback`);
                }
            }
            this.logger.debug('   TitleMatch fallback (basename)', { fileName, basename, maxScore });
            return maxScore;
        }
        this.logger.debug('   TitleMatch path-aware: melhor segmento encontrado', bestSegmentDetails);
        return bestSegmentScore;
    }
    normalizeQuality(quality) {
        const q = quality.toLowerCase().replace(/\s/g, '');
        if (q === '4k' || q === 'uhd')
            return '2160p';
        if (q === 'fullhd' || q === '1080p')
            return '1080p';
        if (q === 'hd' || q === '720p')
            return '720p';
        if (q === 'sd' || q === '480p')
            return '480p';
        return q;
    }
    isReadyStatus(status) {
        return this.staticResponseService.getResponseForTorboxStatus(status) === null;
    }
    async retryableRequest(requestFn, operation) {
        let lastError;
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            this.logger.debug(`retryableRequest: tentativa ${attempt}/${this.maxRetries} para ${operation}`);
            try {
                return await requestFn();
            }
            catch (error) {
                lastError = error;
                if (error instanceof StreamStatusException_js_1.StreamStatusException)
                    throw error;
                const axiosErr = error;
                if (this.isRetryableError(axiosErr) && attempt < this.maxRetries) {
                    const delay = this.baseDelay * Math.pow(2, attempt - 1);
                    this.logger.warn(`Tentativa ${attempt}/${this.maxRetries} falhou, retry em ${delay}ms`);
                    await this.delay(delay);
                    continue;
                }
                this.logger.error(`retryableRequest: falha definitiva na operação ${operation}`, { error: lastError.message });
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
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.TorboxService = TorboxService;
TorboxService.instance = null;
TorboxService.queuedTorrentCache = new Map();
