"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamFormatter = void 0;
const magnetHelper_js_1 = require("../magnet/magnetHelper.js");
const qualityDetector_js_1 = require("../lib/qualityDetector.js");
const logger_js_1 = require("../utils/logger.js");
class StreamFormatter {
    static getInstance() {
        if (!StreamFormatter.instance) {
            StreamFormatter.instance = new StreamFormatter();
        }
        return StreamFormatter.instance;
    }
    constructor() {
        this.logger = new logger_js_1.Logger('StreamFormatter');
        this.qualityDetector = qualityDetector_js_1.QualityDetector.getInstance();
        this.logger.debug('StreamFormatter ready');
    }
    async createMultipleQualityStreams(torrent, request, directLink, type, season, episode, isAvailableOnRD = false, fileIdx, titles, imdbId) {
        const imdbIdFinal = imdbId ?? request.imdbId ?? this.extrairImdbIdDoRequest(request);
        return this.criarStreamsMultiplasQualidades(torrent, request, directLink, type, season, episode, isAvailableOnRD, fileIdx, titles, imdbIdFinal);
    }
    sortStreamsByQuality(streams) {
        return this.ordenarStreamsPorQualidade(streams);
    }
    extrairImdbIdDoRequest(request) {
        if (request.imdbId)
            return request.imdbId;
        const match = request.id?.match(/^(tt\d+)/);
        return match ? match[1] : undefined;
    }
    formatarIdioma(idioma) {
        if (!idioma || typeof idioma !== 'string')
            return 'PT-BR';
        const normalizado = idioma
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim();
        const invalidos = ['desconhecido', 'unknown', 'undefined', 'null', 'n/a', 'na', ''];
        if (invalidos.includes(normalizado))
            return 'PT-BR';
        const mapa = {
            'pt-br': 'PT-BR',
            'pt': 'PT-BR',
            'portugues': 'PT-BR',
            'portuguese': 'PT-BR',
            'brazilian': 'PT-BR',
            'dublado': 'PT-BR',
            'dublada': 'PT-BR',
            'nacional': 'PT-BR',
            'en': 'EN',
            'english': 'EN',
            'eng': 'EN',
            'legendado': 'Leg',
            'legendada': 'Leg',
            'leg': 'Leg',
            'subtitled': 'Leg',
            'dual': 'Dual',
            'dual audio': 'Dual',
            'dualaudio': 'Dual',
            'multi': 'Multi',
            'multilanguage': 'Multi',
            'es': 'ES',
            'esp': 'ES',
            'espanhol': 'ES',
            'espanol': 'ES',
            'spanish': 'ES',
            'fr': 'FR',
            'frances': 'FR',
            'french': 'FR',
        };
        if (mapa[normalizado])
            return mapa[normalizado];
        for (const [chave, valor] of Object.entries(mapa)) {
            const escaped = chave.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
            const regex = new RegExp(`(^|\\s)${escaped}(\\s|$)`);
            if (regex.test(normalizado))
                return valor;
        }
        return 'PT-BR';
    }
    formatarTamanho(size) {
        if (size === undefined || size === null || size === '')
            return null;
        if (typeof size === 'string') {
            if (/\d+\s*(GB|MB|KB)/i.test(size))
                return size;
            const num = Number(size);
            if (!Number.isFinite(num) || num <= 0)
                return null;
            return this.bytesParaHumano(num);
        }
        if (typeof size === 'number' && size > 0) {
            return this.bytesParaHumano(size);
        }
        return null;
    }
    bytesParaHumano(bytes) {
        if (bytes >= 1024 ** 3)
            return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
        if (bytes >= 1024 ** 2)
            return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
        if (bytes >= 1024)
            return `${(bytes / 1024).toFixed(2)} KB`;
        return `${bytes} B`;
    }
    formatTitleCorreto(torrentTitle, seeds, size, language, provider) {
        const linhas = [torrentTitle.trim()];
        const linhaInfos = [`🔗 ${seeds}`];
        const sizeFormatado = this.formatarTamanho(size);
        if (sizeFormatado)
            linhaInfos.push(`💾 ${sizeFormatado}`);
        if (provider)
            linhaInfos.push(`⚙️ ${provider}`);
        linhas.push(linhaInfos.join(' '));
        linhas.push(`🌐 ${this.formatarIdioma(language)}`);
        return linhas.join('\n');
    }
    sanitizarNomeArquivo(nomeArquivo) {
        return nomeArquivo
            .replace(/[<>:"/\\|?*]/g, '_')
            .substring(0, 255);
    }
    montarBehaviorHints(tipo, qualidade, tituloFinal, extras) {
        return {
            notWebReady: false,
            bingeGroup: `br-${tipo || 'movie'}-${qualidade}`,
            filename: this.sanitizarNomeArquivo(tituloFinal.split('\n')[0]),
            streamQuality: qualidade,
            preferredAudioLanguage: 'por',
            ...extras,
        };
    }
    async criarStreamsMultiplasQualidades(torrent, request, linkDireto, tipo, temporada, episodio, disponivelNoRD = false, fileIdx, titles, imdbId) {
        const dadosMagnet = torrent.magnet
            ? await (0, magnetHelper_js_1.analisarMagnet)(torrent.magnet).catch(() => null)
            : null;
        let tituloFonte = torrent.canonicalName || dadosMagnet?.nome || torrent.title;
        if (torrent.htmlTitle && torrent.htmlTitle.trim().length > 0) {
            const htmlClean = torrent.htmlTitle.trim();
            if (!tituloFonte.includes(htmlClean)) {
                const maxHtmlLen = 80;
                const htmlExcerpt = htmlClean.length > maxHtmlLen
                    ? htmlClean.substring(0, maxHtmlLen) + '...'
                    : htmlClean;
                tituloFonte = `${tituloFonte} (${htmlExcerpt})`;
            }
        }
        const qualidades = this.determinarQualidades(torrent, tituloFonte);
        const fileIdxParaStream = fileIdx ?? 0;
        const seeds = torrent.seeders || 0;
        const tamanho = torrent.size;
        const idiomaBruto = torrent.language || 'PT-BR';
        const streams = [];
        for (const qualidade of qualidades) {
            const stream = (disponivelNoRD && linkDireto)
                ? await this.criarStreamDireto({
                    tituloFonte,
                    linkDireto,
                    qualidade,
                    tipo,
                    temporada,
                    episodio,
                    fileIdx: fileIdxParaStream,
                    seeds,
                    tamanho,
                    idiomaBruto,
                })
                : await this.criarStreamLazy({
                    tituloFonte,
                    magnet: torrent.magnet,
                    apiKey: request.apiKey,
                    provider: torrent.provider || 'Torrent',
                    qualidade,
                    tipo,
                    temporada,
                    episodio,
                    fileIdx: fileIdxParaStream,
                    titles,
                    imdbId,
                    seeds,
                    tamanho,
                    idiomaBruto,
                    requestId: request.id,
                    dadosMagnet,
                });
            streams.push(stream);
        }
        return streams;
    }
    determinarQualidades(torrent, tituloFonte) {
        if (torrent.quality && torrent.quality !== 'HD' && torrent.quality !== 'Desconhecido') {
            return [torrent.quality];
        }
        const todas = this.qualityDetector.extractAllQualities(tituloFonte);
        return todas.length > 0 ? todas : ['HD'];
    }
    async criarStreamLazy(params) {
        const { tituloFonte, magnet, apiKey, provider, qualidade, tipo, temporada, episodio, fileIdx, titles, imdbId, seeds, tamanho, idiomaBruto, requestId, dadosMagnet, } = params;
        const dados = dadosMagnet ?? await (0, magnetHelper_js_1.analisarMagnet)(magnet).catch(() => null);
        const magnetHash = dados?.infoHash;
        const qualidadeReal = this.determinarQualidadeReal(qualidade, dados?.nome);
        const tituloComQualidade = this.atualizarQualidadeNoTitulo(tituloFonte, qualidadeReal);
        const tituloFinal = this.formatTitleCorreto(tituloComQualidade, seeds, tamanho, idiomaBruto, provider);
        let resolveUrl = '';
        try {
            const filename = this.sanitizarNomeArquivo(tituloFinal.split('\n')[0] + '.mkv');
            resolveUrl = await (0, magnetHelper_js_1.gerarUrlResolve)(magnet, apiKey, filename, fileIdx, tipo, temporada, episodio, qualidadeReal, magnetHash, titles, imdbId);
        }
        catch (error) {
            this.logger.error('ERRO_GERAR_URL_LAZY', {
                requestId,
                error: error instanceof Error ? error.message : 'Erro desconhecido',
            });
        }
        const stream = {
            name: `Brasil RD\n${qualidadeReal}`,
            title: tituloFinal,
            fileIdx,
        };
        if (resolveUrl)
            stream.url = resolveUrl;
        else
            stream.infoHash = magnetHash || undefined;
        stream.behaviorHints = this.montarBehaviorHints(tipo, qualidadeReal, tituloFinal, { bingeGroup: `br-${requestId}-${qualidadeReal}` });
        return stream;
    }
    async criarStreamDireto(params) {
        const { tituloFonte, linkDireto, qualidade, tipo, temporada, episodio, fileIdx, seeds, tamanho, idiomaBruto, } = params;
        const tituloFinal = this.formatTitleCorreto(tituloFonte, seeds, tamanho, idiomaBruto, 'Torbox');
        const stream = {
            name: `Brasil RD\n${qualidade}`,
            title: tituloFinal,
            infoHash: (await (0, magnetHelper_js_1.analisarMagnet)(linkDireto))?.infoHash || undefined,
            fileIdx,
            url: linkDireto,
        };
        stream.behaviorHints = this.montarBehaviorHints(tipo, qualidade, tituloFinal);
        return stream;
    }
    determinarQualidadeReal(qualidadeScraper, nomeMagnet) {
        if (!nomeMagnet)
            return qualidadeScraper;
        const qualidadeDoMagnet = this.qualityDetector.extractQualityFromFilename(nomeMagnet);
        if (qualidadeDoMagnet && qualidadeDoMagnet !== 'HD' && qualidadeDoMagnet !== 'Desconhecido') {
            this.logger.debug(`Qualidade do magnet (${qualidadeDoMagnet}) substitui a do scraper (${qualidadeScraper})`);
            return qualidadeDoMagnet;
        }
        return qualidadeScraper;
    }
    atualizarQualidadeNoTitulo(titulo, qualidade) {
        const regexQualidade = new RegExp(`\\b${qualidade}\\b`, 'i');
        if (regexQualidade.test(titulo))
            return titulo;
        const regexEntreParenteses = /\s*\(\s*(\d{3,4}p|4k|uhd|hd)\s*\)/i;
        if (regexEntreParenteses.test(titulo)) {
            return titulo.replace(regexEntreParenteses, ` (${qualidade})`);
        }
        return `${titulo} (${qualidade})`;
    }
    ordenarStreamsPorQualidade(streams) {
        return streams.sort((a, b) => {
            const tierA = this.getTier(a);
            const tierB = this.getTier(b);
            if (tierA !== tierB)
                return tierA - tierB;
            const seedsA = this.extrairSeeds(a);
            const seedsB = this.extrairSeeds(b);
            if (seedsA !== seedsB)
                return seedsB - seedsA;
            const sizeA = this.extrairTamanhoDoTitulo(a.title);
            const sizeB = this.extrairTamanhoDoTitulo(b.title);
            if (sizeA !== sizeB)
                return sizeB - sizeA;
            return (a.title || '').localeCompare(b.title || '');
        });
    }
    getTier(s) {
        const q = (s.behaviorHints?.streamQuality || '').toLowerCase();
        if (q) {
            const normalized = this.qualityDetector.extractBestQuality(q);
            if (normalized && normalized !== 'unknown') {
                return this.qualityDetector.getQualityOrder(normalized);
            }
        }
        const match = (s.name || '').match(/\b(\d{3,4}p|4k|uhd|hd|sd)\b/i);
        if (match) {
            const normalized = this.qualityDetector.extractBestQuality(match[1]);
            if (normalized && normalized !== 'unknown') {
                return this.qualityDetector.getQualityOrder(normalized);
            }
        }
        return this.qualityDetector.getQualityOrder('HD');
    }
    extrairSeeds(s) {
        const t = s.title || '';
        const m1 = t.match(/🔗\s*(\d+)/);
        if (m1)
            return parseInt(m1[1]);
        const m2 = t.match(/(\d+)\s*seeds?/i);
        if (m2)
            return parseInt(m2[1]);
        return 0;
    }
    extrairTamanhoDoTitulo(title) {
        if (!title)
            return 0;
        const lines = title.split('\n');
        if (lines.length >= 2) {
            const match = lines[1].match(/💾\s*([\d.]+)\s*(GB|MB)/i);
            if (match) {
                const value = parseFloat(match[1]);
                return match[2].toUpperCase() === 'MB' ? value / 1024 : value;
            }
        }
        return 0;
    }
}
exports.StreamFormatter = StreamFormatter;
