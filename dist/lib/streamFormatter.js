"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamFormatter = void 0;
const magnetHelper_1 = require("../lib/magnetHelper");
const qualityDetector_1 = require("../lib/qualityDetector");
const logger_1 = require("../utils/logger");
const MetadataExtractor_1 = require("../lib/title-filter/MetadataExtractor");
class StreamFormatter {
    static getInstance() {
        if (!StreamFormatter.instance) {
            StreamFormatter.instance = new StreamFormatter();
        }
        return StreamFormatter.instance;
    }
    constructor() {
        this.logger = new logger_1.Logger('StreamFormatter');
        this.qualityDetector = qualityDetector_1.QualityDetector.getInstance();
        this.metadataExtractor = MetadataExtractor_1.MetadataExtractor.getInstance();
        this.logger.debug('StreamFormatter ready');
    }
    formatTitleCorreto(torrentTitle, seeds, size, language, tracker, metadata, isDirect = false) {
        let result = torrentTitle.trim();
        let segundaLinha = '';
        if (seeds !== undefined && seeds > 0) {
            segundaLinha += `🔗 ${seeds}`;
        }
        else {
            segundaLinha += `🔗 0`;
        }
        if (size) {
            segundaLinha += ` 💾 ${size}`;
        }
        if (tracker) {
            segundaLinha += ` ⚙️ ${tracker}`;
        }
        if (segundaLinha) {
            result += '\n' + segundaLinha;
        }
        const terceiraParts = [];
        const idiomaFormatado = this.formatarIdioma(language || 'PT-BR');
        terceiraParts.push(`🌐 ${idiomaFormatado}`);
        if (metadata) {
            if (metadata.isCompleteSeason)
                terceiraParts.push('📦');
            if (metadata.isPackage)
                terceiraParts.push('🎬');
            if (metadata.hasMultiEpisode)
                terceiraParts.push('👥');
            if (metadata.source && metadata.source !== 'unknown')
                terceiraParts.push('🎞️');
            if (metadata.codec && metadata.codec !== 'unknown')
                terceiraParts.push('🔧');
        }
        if (isDirect) {
            terceiraParts.push('🚀');
        }
        else {
            terceiraParts.push('⏳');
        }
        if (terceiraParts.length > 0) {
            result += '\n' + terceiraParts.join(' ');
        }
        return result;
    }
    formatarIdioma(idioma) {
        if (!idioma)
            return 'PT-BR';
        const idiomaNormalizado = idioma.toLowerCase().trim();
        const mapaIdiomas = {
            'pt-br': 'PT-BR',
            'pt': 'PT-BR',
            'portuguese': 'PT-BR',
            'brazilian': 'PT-BR',
            'dublado': 'PT-BR',
            'en': 'EN',
            'english': 'EN',
            'eng': 'EN',
            'legendado': 'EN',
            'dual': 'Dual',
            'dual audio': 'Dual',
            'dualaudio': 'Dual',
            'pt-br,en': 'Dual',
            'pt-br,en-us': 'Dual',
            'portuguese,english': 'Dual',
            'dublado,legendado': 'Dual',
            'multi': 'Multi',
            'multilanguage': 'Multi',
            'pt-br,en-us,ja-jp': 'Multi',
            'portuguese,english,japanese': 'Multi',
            'es': 'ES',
            'spanish': 'ES',
            'esp': 'ES',
            'fr': 'FR',
            'french': 'FR'
        };
        if (mapaIdiomas[idiomaNormalizado]) {
            return mapaIdiomas[idiomaNormalizado];
        }
        for (const [chave, valor] of Object.entries(mapaIdiomas)) {
            if (idiomaNormalizado.includes(chave)) {
                return valor;
            }
        }
        return idioma.toUpperCase();
    }
    extrairTracker(magnet) {
        if (!magnet)
            return 'Torrent';
        if (magnet.includes('thepiratebay'))
            return 'ThePirateBay';
        if (magnet.includes('1337x'))
            return '1337x';
        if (magnet.includes('rarbg'))
            return 'RARBG';
        if (magnet.includes('torrentgalaxy'))
            return 'TorrentGalaxy';
        if (magnet.includes('magnetdl'))
            return 'MagnetDL';
        return 'Torrent';
    }
    criarStreamDireto(torrentTitle, descricao, linkDireto, qualidade, tipo, temporada, episodio, behaviorHints, metadata, fileIdx) {
        this.logger.debug('CRIANDO_STREAM_DIRETO', {
            qualidade: qualidade,
            tipo: tipo,
            temporada: temporada,
            episodio: episodio
        });
        const seedsMatch = descricao.match(/(\d+)\s*seeds?/i);
        const sizeMatch = descricao.match(/(\d+(?:\.\d+)?)\s*(GB|MB)/i);
        const idiomaDaDescricao = this.extrairIdiomaDaDescricao(descricao);
        const seeds = seedsMatch ? parseInt(seedsMatch[1]) : 0;
        const tamanho = sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2]}` : undefined;
        const tituloFinal = this.formatTitleCorreto(torrentTitle, seeds, tamanho, idiomaDaDescricao, 'Torbox', metadata, true);
        const stream = {
            name: `Brasil RD\n${qualidade}`,
            title: tituloFinal,
            infoHash: (0, magnetHelper_1.extractHashFromMagnet)(linkDireto) || undefined,
            fileIdx: fileIdx !== undefined ? fileIdx : 0,
            url: linkDireto
        };
        if (behaviorHints) {
            stream.behaviorHints = {
                notWebReady: false,
                bingeGroup: `br-${tipo || 'movie'}-${qualidade}`,
                filename: this.sanitizarNomeArquivo(tituloFinal.split('\n')[0]),
                streamQuality: qualidade,
                ...behaviorHints
            };
        }
        this.logger.debug('STREAM_DIRETO_CRIADO', {
            titulo: tituloFinal.substring(0, 80).replace(/\n/g, '\\n'),
            infoHash: stream.infoHash ? 'sim' : 'nao',
            fileIdx: stream.fileIdx,
            tem_url: !!stream.url,
            formato: 'torrentio_com_titulo_correto'
        });
        return stream;
    }
    criarStreamLazy(torrentTitle, descricao, magnet, apiKey, qualidade, tipo, temporada, episodio, behaviorHints, metadata, fileIdx) {
        this.logger.debug('CRIANDO_STREAM_LAZY', {
            qualidade: qualidade,
            tipo: tipo,
            temporada: temporada,
            episodio: episodio
        });
        const magnetHash = (0, magnetHelper_1.extractHashFromMagnet)(magnet);
        const seedsMatch = descricao.match(/(\d+)\s*seeds?/i);
        const sizeMatch = descricao.match(/(\d+(?:\.\d+)?)\s*(GB|MB)/i);
        const idiomaDaDescricao = this.extrairIdiomaDaDescricao(descricao);
        const tracker = this.extrairTracker(magnet);
        const seeds = seedsMatch ? parseInt(seedsMatch[1]) : 0;
        const tamanho = sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2]}` : undefined;
        const tituloFinal = this.formatTitleCorreto(torrentTitle, seeds, tamanho, idiomaDaDescricao, tracker, metadata, false);
        let resolveUrl = '';
        try {
            const filename = this.sanitizarNomeArquivo(tituloFinal.split('\n')[0] + '.mkv');
            resolveUrl = (0, magnetHelper_1.generateLazyResolveUrl)(magnet, apiKey, filename, fileIdx || 0, tipo, temporada, episodio);
            this.logger.debug('URL_LAZY_GERADA', {
                formato: 'torrentio_rd',
                url_preview: resolveUrl.substring(0, 100),
                filename: filename,
                fileIdx: fileIdx || 0
            });
        }
        catch (error) {
            this.logger.error('ERRO_GERAR_URL_LAZY', {
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
        }
        const stream = {
            name: `Brasil RD\n${qualidade}`,
            title: tituloFinal,
            fileIdx: fileIdx !== undefined ? fileIdx : 0
        };
        if (resolveUrl) {
            stream.url = resolveUrl;
        }
        else {
            stream.infoHash = magnetHash || undefined;
        }
        if (behaviorHints) {
            stream.behaviorHints = {
                notWebReady: false,
                bingeGroup: `br-${tipo || 'movie'}-${qualidade}`,
                filename: this.sanitizarNomeArquivo(tituloFinal.split('\n')[0]),
                streamQuality: qualidade,
                ...behaviorHints
            };
        }
        if (metadata?.isPackage && stream.behaviorHints) {
            stream.behaviorHints.packageContent = true;
        }
        this.logger.debug('STREAM_LAZY_CRIADO', {
            titulo: tituloFinal.substring(0, 80).replace(/\n/g, '\\n'),
            infoHash: stream.infoHash ? 'sim' : 'nao',
            fileIdx: stream.fileIdx,
            tem_url: !!stream.url,
            formato: 'torrentio_com_titulo_correto_e_url'
        });
        return stream;
    }
    extrairIdiomaDaDescricao(descricao) {
        const padroesIdioma = [
            /(PT-BR|Dual|EN|Multi|ES|FR)/i,
            /(portuguese|english|spanish|french)/i,
            /(dublado|legendado|subtitled)/i
        ];
        for (const padrao of padroesIdioma) {
            const match = descricao.match(padrao);
            if (match) {
                return match[1];
            }
        }
        return 'PT-BR';
    }
    criarStreamsMultiplasQualidades(torrent, request, linkDireto, tipo, temporada, episodio, disponivelNoRD = false, fileIdx) {
        const todasQualidades = this.extrairTodasQualidades(torrent.title);
        this.logger.debug('PROCESSANDO_MULTIPLAS_QUALIDADES', {
            titulo_torrent: torrent.title.substring(0, 80),
            qualidades_encontradas: todasQualidades.length,
            tipo: tipo,
            temporada: temporada,
            episodio: episodio
        });
        if (todasQualidades.length === 0) {
            const qualidadePadrao = this.qualityDetector.extractBestQuality(torrent.title);
            if (qualidadePadrao && qualidadePadrao !== 'unknown') {
                todasQualidades.push(qualidadePadrao);
            }
            else {
                todasQualidades.push('HD');
            }
        }
        const streams = [];
        const metadata = this.metadataExtractor.extractEnhancedMetadata(torrent.title);
        const tagEpisodio = tipo === 'series' && temporada && episodio
            ? `S${temporada.toString().padStart(2, '0')}E${episodio.toString().padStart(2, '0')}`
            : '';
        for (const qualidade of todasQualidades) {
            const descricaoBase = `${torrent.title}\n${torrent.seeders || 0} seeds | ${torrent.size || 'N/A'} | ${this.formatarIdioma(torrent.language || 'PT-BR')}`;
            const nomeStream = `Brasil RD (${qualidade})`;
            const tituloCompletoTorrent = torrent.title;
            if (disponivelNoRD && linkDireto) {
                streams.push(this.criarStreamDireto(tituloCompletoTorrent, descricaoBase, linkDireto, qualidade, tipo, temporada, episodio, {
                    bingeGroup: `br-${request.id}-${qualidade}`,
                    filename: this.sanitizarNomeArquivo(`${torrent.title} ${tagEpisodio}`)
                }, metadata, fileIdx));
            }
            else {
                streams.push(this.criarStreamLazy(tituloCompletoTorrent, descricaoBase, torrent.magnet, request.apiKey, qualidade, tipo, temporada, episodio, {
                    bingeGroup: `br-${request.id}-${qualidade}`,
                    filename: this.sanitizarNomeArquivo(`${torrent.title} ${tagEpisodio}`)
                }, metadata, fileIdx));
            }
            this.logger.debug('QUALIDADE_STREAM_CRIADA', {
                qualidade: qualidade,
                tipo: tipo,
                temporada: temporada,
                episodio: episodio,
                tem_link_direto: !!(disponivelNoRD && linkDireto),
                formato: 'torrentio_corrigido'
            });
        }
        this.logger.info('STREAMS_CRIADOS_COM_SUCESSO', {
            total: streams.length,
            qualidades: todasQualidades,
            torrent: torrent.title.substring(0, 60),
            streams_com_url: streams.filter(s => s.url).length,
            streams_sem_url: streams.filter(s => !s.url).length,
            versao: '2.0.0',
            formato: 'torrentio_corrigido_com_url'
        });
        return streams;
    }
    extrairTodasQualidades(titulo) {
        const padroesQualidade = [
            /\b(2160p|4k|uhd)\b/gi,
            /\b(1080p|fullhd|full hd)\b/gi,
            /\b(720p|hd|high definition)\b/gi,
            /\b(480p|sd|standard definition)\b/gi,
            /\b(360p|low)\b/gi,
            /(\d{3,4}p)\s*\/\s*(\d{3,4}p)/gi,
            /(\d{3,4}p)\s*[eE]\s*(\d{3,4}p)/gi,
            /(\d{3,4}p)\s*[ou]\s*(\d{3,4}p)/gi
        ];
        const qualidadesEncontradas = new Set();
        const tituloLower = titulo.toLowerCase();
        for (const padrao of padroesQualidade.slice(0, 5)) {
            const matches = tituloLower.match(padrao);
            if (matches) {
                for (const match of matches) {
                    const normalizada = this.normalizarQualidade(match);
                    if (normalizada) {
                        qualidadesEncontradas.add(normalizada);
                    }
                }
            }
        }
        for (const padrao of padroesQualidade.slice(5)) {
            const matches = tituloLower.match(padrao);
            if (matches) {
                for (const match of matches) {
                    const qualityMatches = match.match(/\d{3,4}p/gi);
                    if (qualityMatches) {
                        for (const qualityMatch of qualityMatches) {
                            const normalizada = this.normalizarQualidade(qualityMatch);
                            if (normalizada) {
                                qualidadesEncontradas.add(normalizada);
                            }
                        }
                    }
                }
            }
        }
        const listPattern = /(\d{3,4}p|4k|uhd|hd)(?:\s*,\s*|\s+e\s+|\s+ou\s+)/gi;
        let listMatch;
        while ((listMatch = listPattern.exec(tituloLower)) !== null) {
            const normalizada = this.normalizarQualidade(listMatch[1]);
            if (normalizada) {
                qualidadesEncontradas.add(normalizada);
            }
        }
        const resultado = Array.from(qualidadesEncontradas);
        if (resultado.length === 0) {
            const qualidadePadrao = this.qualityDetector.extractBestQuality(titulo);
            if (qualidadePadrao && qualidadePadrao !== 'unknown') {
                resultado.push(qualidadePadrao);
            }
        }
        const ordemQualidade = ['2160p', '1080p', '720p', 'HD', 'SD'];
        resultado.sort((a, b) => {
            const indexA = ordemQualidade.indexOf(a);
            const indexB = ordemQualidade.indexOf(b);
            return indexA - indexB;
        });
        return resultado;
    }
    normalizarQualidade(qualidade) {
        const qualidadeLower = qualidade.toLowerCase();
        if (qualidadeLower.includes('4k') || qualidadeLower.includes('2160p') || qualidadeLower.includes('uhd')) {
            return '2160p';
        }
        else if (qualidadeLower.includes('1080p') || qualidadeLower.includes('fullhd') || qualidadeLower.includes('full hd')) {
            return '1080p';
        }
        else if (qualidadeLower.includes('720p') || qualidadeLower.includes('hd') || qualidadeLower.includes('high definition')) {
            return '720p';
        }
        else if (qualidadeLower.includes('480p') || qualidadeLower.includes('sd') || qualidadeLower.includes('standard definition')) {
            return 'SD';
        }
        else if (qualidadeLower.includes('360p') || qualidadeLower.includes('low')) {
            return 'SD';
        }
        else if (qualidadeLower.includes('hd')) {
            return 'HD';
        }
        if (qualidadeLower.match(/\d{3,4}p/)) {
            return qualidadeLower;
        }
        return '';
    }
    criarStreamSerie(torrent, request, linkDireto, temporada, episodio, disponivelNoRD = false, fileIdx) {
        const qualidades = this.extrairTodasQualidades(torrent.title);
        const qualidade = qualidades.length > 0 ? qualidades[0] : this.qualityDetector.extractBestQuality(torrent.title);
        const descricaoBase = `${torrent.title}\n${torrent.seeders || 0} seeds | ${torrent.size || 'N/A'} | ${this.formatarIdioma(torrent.language || 'PT-BR')}`;
        return this.criarStreamLazy(torrent.title, descricaoBase, torrent.magnet, request.apiKey, qualidade, 'series', temporada, episodio, {
            bingeGroup: `br-${request.id}-${qualidade}`,
            filename: this.sanitizarNomeArquivo(torrent.title)
        }, undefined, fileIdx);
    }
    criarStreamFilme(torrent, request, linkDireto, disponivelNoRD = false, fileIdx) {
        const qualidades = this.extrairTodasQualidades(torrent.title);
        const qualidade = qualidades.length > 0 ? qualidades[0] : this.qualityDetector.extractBestQuality(torrent.title);
        const descricaoBase = `${torrent.title}\n${torrent.seeders || 0} seeds | ${torrent.size || 'N/A'} | ${this.formatarIdioma(torrent.language || 'PT-BR')}`;
        return this.criarStreamLazy(torrent.title, descricaoBase, torrent.magnet, request.apiKey, qualidade, 'movie', undefined, undefined, {
            bingeGroup: `br-${request.id}-${qualidade}`,
            filename: this.sanitizarNomeArquivo(torrent.title)
        }, undefined, fileIdx);
    }
    ordenarStreamsPorQualidade(streams) {
        const prioridadeQualidade = {
            '2160p': 100,
            '4K': 100,
            '1080p': 80,
            '720p': 60,
            'HD': 40,
            'SD': 20
        };
        return streams.sort((a, b) => {
            const scoreA = this.calcularScoreQualidade(a);
            const scoreB = this.calcularScoreQualidade(b);
            if (scoreB !== scoreA) {
                return scoreB - scoreA;
            }
            const seedsA = this.extrairSeedsDoTitulo(a.title);
            const seedsB = this.extrairSeedsDoTitulo(b.title);
            if (seedsB !== seedsA)
                return seedsB - seedsA;
            return (a.title || '').localeCompare(b.title || '');
        });
    }
    extrairSeedsDoTitulo(title) {
        if (!title)
            return 0;
        const lines = title.split('\n');
        if (lines.length >= 2) {
            const match = lines[1].match(/🔗\s*(\d+)/);
            if (match)
                return parseInt(match[1]);
        }
        return 0;
    }
    calcularScoreQualidade(stream) {
        const prioridadeQualidade = {
            '2160p': 100,
            '4K': 100,
            '1080p': 80,
            '720p': 60,
            'HD': 40,
            'SD': 20
        };
        const bhQuality = stream.behaviorHints?.streamQuality;
        if (bhQuality && prioridadeQualidade[bhQuality] !== undefined) {
            return prioridadeQualidade[bhQuality];
        }
        const qualidade = this.qualityDetector.extractBestQuality(stream.title || '');
        return prioridadeQualidade[qualidade] || 0;
    }
    sanitizarNomeArquivo(nomeArquivo) {
        return nomeArquivo
            .replace(/[<>:"/\\|?*]/g, '_')
            .substring(0, 255);
    }
    createMultipleQualityStreams(torrent, request, directLink, type, season, episode, isAvailableOnRD = false, fileIdx) {
        return this.criarStreamsMultiplasQualidades(torrent, request, directLink, type, season, episode, isAvailableOnRD, fileIdx);
    }
    createSeriesStream(torrent, request, directLink, season, episode, isAvailableOnRD = false, fileIdx) {
        return this.criarStreamSerie(torrent, request, directLink, season, episode, isAvailableOnRD, fileIdx);
    }
    createMovieStream(torrent, request, directLink, isAvailableOnRD = false, fileIdx) {
        return this.criarStreamFilme(torrent, request, directLink, isAvailableOnRD, fileIdx);
    }
    sortStreamsByQuality(streams) {
        return this.ordenarStreamsPorQualidade(streams);
    }
    getStats() {
        return {
            versao: '2.1.0',
            feature: 'Formato Torrentio-style com identidade Brasil RD',
            linha1: 'Titulo completo do torrent',
            linha2: '🔗 seeds 💾 tamanho ⚙️ tracker (sem |, estilo Torrentio)',
            linha3: '🌐 idioma + metadados + ⏳/🚀 status',
            name: 'Brasil RD\\n{qualidade} (como Torrentio)',
            emojis_originais: '🔗 💾 ⚙️ 🌐 ⏳ 🚀',
            compatibilidade: 'Stremio Web/Desktop/Mobile/TV 100%'
        };
    }
}
exports.StreamFormatter = StreamFormatter;
