"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TitleFilter = void 0;
const logger_js_1 = require("../utils/logger.js");
const SimilarityCalculator_js_1 = require("./SimilarityCalculator.js");
const LanguageDetector_js_1 = require("./LanguageDetector.js");
const episodeMatcher_js_1 = require("./episodeMatcher.js");
const TechnicalWords_js_1 = require("./TechnicalWords.js");
class TitleFilter {
    constructor() {
        this.logger = new logger_js_1.Logger('TitleFilter');
        this.similarityCalculator = SimilarityCalculator_js_1.SimilarityCalculator.getInstance();
        this.languageDetector = LanguageDetector_js_1.LanguageDetector.getInstance();
        this.episodeMatcher = episodeMatcher_js_1.EpisodeMatcher.getInstance();
    }
    static getInstance() {
        if (!TitleFilter.instance)
            TitleFilter.instance = new TitleFilter();
        return TitleFilter.instance;
    }
    extrairMetadados(titulo) {
        const range = (0, TechnicalWords_js_1.extrairRangeEpisodios)(titulo);
        const isCompleteSeason = range
            ? (range.seasonStart > 0 && range.episodeStart === 0 && range.episodeEnd === 0)
            : this.episodeMatcher.ehPackTemporadaCompleta(titulo);
        return {
            season: range?.seasonStart ?? undefined,
            episode: range?.episodeStart ?? undefined,
            isCompleteSeason,
            hasEpisodeInfo: !!(range && (range.seasonStart > 0 || range.episodeStart > 0)),
            matchedPattern: undefined,
        };
    }
    conteudoEmPortugues(titulo) {
        return this.languageDetector.isPortugueseContent(titulo);
    }
    verificarIdiomaDetalhado(titulo) {
        return this.languageDetector.verificarIdioma(titulo);
    }
    async titulosCombinam(tituloTorrent, imdbId, temporadaAlvo, episodioAlvo, tituloParaIdioma, anoDoScraper, imdbTitles, htmlTitle, episodioTorrent, imdbConfirmed, years, tipoConteudo) {
        const shortTitle = tituloTorrent.substring(0, 60);
        try {
            const metadados = this.extrairMetadados(tituloTorrent);
            const tituloParaRange = tituloTorrent || htmlTitle || tituloParaIdioma;
            let range = tituloParaRange ? (0, TechnicalWords_js_1.extrairRangeEpisodios)(tituloParaRange) : null;
            if (!range && htmlTitle) {
                range = (0, TechnicalWords_js_1.extrairRangeEpisodios)(htmlTitle);
            }
            if (!range && tituloParaIdioma) {
                range = (0, TechnicalWords_js_1.extrairRangeEpisodios)(tituloParaIdioma);
            }
            const rangeStr = range
                ? `S${range.seasonStart}${range.seasonEnd !== range.seasonStart ? `-S${range.seasonEnd}` : ''}${range.episodeStart > 0 ? `E${range.episodeStart}${range.episodeEnd !== range.episodeStart ? `-E${range.episodeEnd}` : ''}` : ''}`
                : 'null';
            this.logger.debug(`TF-STEP-0 ENTRADA | "${shortTitle}" | alvo=S${temporadaAlvo ?? '?'}E${episodioAlvo ?? '?'} | imdbAno=${imdbTitles?.year ?? '?'} | imdbConfirmed=${imdbConfirmed ?? false}`);
            const anoDoTitulo = (0, TechnicalWords_js_1.extrairAno)(tituloTorrent)?.[0];
            const anoDoTituloParaIdioma = tituloParaIdioma ? (0, TechnicalWords_js_1.extrairAno)(tituloParaIdioma)?.[0] : undefined;
            const anoTorrent = anoDoScraper || anoDoTitulo || anoDoTituloParaIdioma;
            const isCollection = (0, TechnicalWords_js_1.isCollectionTitle)(tituloTorrent);
            const yearsDoTitulo = (0, TechnicalWords_js_1.extrairAno)(tituloTorrent);
            const yearsEfetivos = (years && years.length > 0) ? years : yearsDoTitulo;
            this.logger.debug(`TF-STEP-1 ESTADO | ano=${anoTorrent ?? '-'} (scraper=${anoDoScraper ?? '-'} titulo=${anoDoTitulo ?? '-'} idioma=${anoDoTituloParaIdioma ?? '-'}) | isCollection=${isCollection} | years=[${yearsEfetivos?.join(',') ?? '-'}] | range=${rangeStr}`);
            if (temporadaAlvo !== undefined) {
                if (range && range.seasonStart > 0 && !(0, TechnicalWords_js_1.temporadaAlvoNoRange)(range, temporadaAlvo)) {
                    this.logger.info(`🚫 TF-STEP-1b REJEITA_TEMPORADA | "${shortTitle}" | range=S${range.seasonStart}-S${range.seasonEnd} vs alvo=S${temporadaAlvo}`);
                    return {
                        matches: false,
                        similarity: 0,
                        torrentMetadata: metadados,
                        reason: `Temporada diferente: S${range.seasonStart}-S${range.seasonEnd} vs S${temporadaAlvo}`
                    };
                }
                this.logger.debug(`TF-STEP-1b PASSA_TEMPORADA | "${shortTitle}" | range=${rangeStr} | alvo=S${temporadaAlvo}`);
            }
            else {
                this.logger.debug(`TF-STEP-1b SKIP_SEM_ALVO | "${shortTitle}"`);
            }
            let isYearInCollection = false;
            if (yearsEfetivos && imdbTitles?.year !== undefined) {
                if (yearsEfetivos.length > 1) {
                    const minYear = Math.min(...yearsEfetivos);
                    const maxYear = Math.max(...yearsEfetivos);
                    isYearInCollection = imdbTitles.year >= minYear && imdbTitles.year <= maxYear;
                }
                else if (yearsEfetivos.length === 1) {
                    isYearInCollection = Math.abs(yearsEfetivos[0] - imdbTitles.year) <= 1;
                }
            }
            this.logger.debug(`TF-STEP-2 ANO | titulo=${anoTorrent ?? '-'} vs imdb=${imdbTitles?.year ?? '-'} | diff=${anoTorrent !== undefined && imdbTitles?.year !== undefined ? Math.abs(anoTorrent - imdbTitles.year) : '?'} | isYearInCollection=${isYearInCollection} | isCollection=${isCollection} | imdbConfirmed=${imdbConfirmed ?? false}`);
            if (!imdbConfirmed &&
                !isCollection &&
                !isYearInCollection &&
                anoTorrent !== undefined &&
                imdbTitles?.year !== undefined &&
                Math.abs(anoTorrent - imdbTitles.year) > 1) {
                this.logger.info(`🚫 TF-STEP-3 REJEITA_ANO | "${shortTitle}" | ano=${anoTorrent} vs imdb=${imdbTitles.year} | diff=${Math.abs(anoTorrent - imdbTitles.year)}`);
                return {
                    matches: false,
                    similarity: 0,
                    torrentMetadata: metadados,
                    reason: `Ano divergente: ${anoTorrent} vs ${imdbTitles.year}`
                };
            }
            this.logger.debug(`TF-STEP-3 PASSA_ANO | "${shortTitle}"`);
            if (imdbConfirmed &&
                !isCollection &&
                anoTorrent !== undefined &&
                imdbTitles?.year !== undefined &&
                Math.abs(anoTorrent - imdbTitles.year) > 1) {
                this.logger.debug(`TF-STEP-3b SKIP_ANO_POR_IMDB | "${shortTitle}" | ano=${anoTorrent} imdbAno=${imdbTitles.year} diff=${Math.abs(anoTorrent - imdbTitles.year)}`);
            }
            if (isCollection && isYearInCollection) {
                const titulosComparar = imdbTitles?.allTitles?.filter(t => t && t.trim().length > 0) ?? [];
                if (titulosComparar.length === 0) {
                    this.logger.info(`🚫 TF-STEP-4 REJEITA_COLECAO_SEM_TITULOS | "${shortTitle}" | sem allTitles no TMDB`);
                    return {
                        matches: false,
                        similarity: 0,
                        torrentMetadata: metadados,
                        reason: 'Coleção sem títulos TMDB para comparar'
                    };
                }
                const comparacao = this.similarityCalculator.compararComTitulos(titulosComparar, tituloTorrent, SimilarityCalculator_js_1.SimilarityCalculator.THRESHOLD_PRE_FILTRO);
                if (!comparacao.match) {
                    this.logger.info(`🚫 TF-STEP-4 REJEITA_COLECAO_SEM_MATCH | "${shortTitle}" | score=${comparacao.score.toFixed(2)} < ${SimilarityCalculator_js_1.SimilarityCalculator.THRESHOLD_PRE_FILTRO}`);
                    return {
                        matches: false,
                        similarity: 0,
                        torrentMetadata: metadados,
                        reason: `Coleção sem match de título (score ${comparacao.score.toFixed(2)})`
                    };
                }
                this.logger.info(`✅ TF-STEP-4 ACEITA_COLECAO | "${shortTitle}" | imdbAno=${imdbTitles?.year} | score=${comparacao.score.toFixed(2)} | years=[${yearsEfetivos?.join(',')}]`);
                return {
                    matches: true,
                    similarity: 0.8,
                    torrentMetadata: metadados,
                    reason: `Coleção com match de título (score ${comparacao.score.toFixed(2)})`
                };
            }
            if (isCollection &&
                yearsEfetivos &&
                yearsEfetivos.length > 1 &&
                imdbTitles?.year !== undefined &&
                !isYearInCollection) {
                this.logger.info(`🚫 TF-STEP-4 REJEITA_COLECAO_ANO | "${shortTitle}" | years=[${yearsEfetivos.join('-')}] não contém ${imdbTitles.year}`);
                return {
                    matches: false,
                    similarity: 0,
                    torrentMetadata: metadados,
                    reason: `Coleção ${yearsEfetivos.join('-')} não contém ${imdbTitles.year}`
                };
            }
            this.logger.debug(`TF-STEP-5 RANGE | extraido=${rangeStr} | alvo=S${temporadaAlvo ?? '?'}E${episodioAlvo ?? '?'} | episodioTorrent=${episodioTorrent ?? '-'}`);
            if (episodioAlvo !== undefined) {
                const temRange = range && range.episodeStart > 0 && range.episodeEnd > 0;
                if (temRange) {
                    if (episodioAlvo < range.episodeStart || episodioAlvo > range.episodeEnd) {
                        this.logger.info(`🚫 TF-STEP-6 REJEITA_EPISODIO_RANGE | "${shortTitle}" | alvo=E${episodioAlvo} vs range=E${range.episodeStart}-E${range.episodeEnd}`);
                        return {
                            matches: false,
                            similarity: 0,
                            torrentMetadata: metadados,
                            reason: `Episódio fora do range: E${episodioAlvo} vs E${range.episodeStart}-E${range.episodeEnd}`
                        };
                    }
                    this.logger.debug(`TF-STEP-6 PASSA_EPISODIO_RANGE | alvo=E${episodioAlvo} dentro de E${range.episodeStart}-E${range.episodeEnd}`);
                }
                else if (episodioTorrent !== undefined && episodioTorrent > 0) {
                    if (episodioTorrent !== episodioAlvo) {
                        this.logger.info(`🚫 TF-STEP-6 REJEITA_EPISODIO | "${shortTitle}" | torrent=E${episodioTorrent} vs alvo=E${episodioAlvo}`);
                        return {
                            matches: false,
                            similarity: 0,
                            torrentMetadata: metadados,
                            reason: `Episódio diferente: E${episodioTorrent} vs alvo E${episodioAlvo}`
                        };
                    }
                    this.logger.debug(`TF-STEP-6 PASSA_EPISODIO | torrent=E${episodioTorrent} == alvo=E${episodioAlvo}`);
                }
                else {
                    const isSeasonPack = range && range.seasonStart > 0 && range.episodeStart === 0 && range.episodeEnd === 0;
                    if (isSeasonPack && temporadaAlvo !== undefined && (0, TechnicalWords_js_1.temporadaAlvoNoRange)(range, temporadaAlvo)) {
                        this.logger.debug(`TF-STEP-6 PASSA_PACK_SEASON | temporadaAlvo=S${temporadaAlvo} no range S${range.seasonStart}-S${range.seasonEnd}`);
                    }
                }
            }
            else {
                this.logger.debug(`TF-STEP-6 SKIP_SEM_EPISODIO_ALVO`);
            }
            if (range && temporadaAlvo !== undefined) {
                const dentro = (0, TechnicalWords_js_1.temporadaAlvoNoRange)(range, temporadaAlvo);
                this.logger.debug(`TF-STEP-7 TEMPORADA | range=S${range.seasonStart}-S${range.seasonEnd} | alvo=S${temporadaAlvo} | contem=${dentro}`);
                if (!dentro) {
                    this.logger.info(`🚫 TF-STEP-7 REJEITA_TEMPORADA | "${shortTitle}" | range=S${range.seasonStart}-S${range.seasonEnd} vs alvo=S${temporadaAlvo}`);
                    return {
                        matches: false,
                        similarity: 0,
                        torrentMetadata: metadados,
                        reason: `Temporada diferente: S${range.seasonStart}-S${range.seasonEnd} vs S${temporadaAlvo}`
                    };
                }
            }
            else {
                this.logger.debug(`TF-STEP-7 SKIP_SEM_RANGE | range=${range ? 'tem' : 'null'} | temporadaAlvo=${temporadaAlvo ?? '-'}`);
            }
            if (imdbConfirmed && !isCollection) {
                this.logger.info(`✅ TF-STEP-8 ACEITA_IMDB_CONFIRMADO | "${shortTitle}" | imdbId=${imdbId}`);
                return {
                    matches: true,
                    similarity: 0.9,
                    torrentMetadata: metadados,
                    reason: 'IMDb confirmado no post'
                };
            }
            const seasonParaSimilaridade = temporadaAlvo;
            this.logger.debug(`TF-STEP-9 SIMILARITY | "${shortTitle}" | year=${anoTorrent ?? '-'} | years=[${yearsEfetivos?.join(',') ?? '-'}] | imdbAno=${imdbTitles?.year ?? '-'} | isYearInCollection=${isYearInCollection} | tipo=${tipoConteudo ?? '?'}`);
            const resultado = await this.similarityCalculator.smartTitleContainsCheck(tituloTorrent, imdbId, { year: anoTorrent, season: seasonParaSimilaridade, years: yearsEfetivos, tipoConteudo }, tituloParaIdioma, imdbTitles ?? undefined);
            if (resultado.mediaType === 'movie' && this.episodeMatcher.temIndicadorTemporada(tituloTorrent)) {
                this.logger.info(`🚫 TF-STEP-9 REJEITA_MEDIA_TYPE | "${shortTitle}" | torrent=temporada, tmdb=movie`);
                return {
                    matches: false,
                    similarity: 0,
                    torrentMetadata: metadados,
                    reason: 'Torrent é série, mas TMDB diz que é filme'
                };
            }
            const icone = resultado.matches ? '✅' : '🚫';
            this.logger.info(`${icone} TF-FINAL | matches=${resultado.matches} | "${shortTitle}" | reason="${resultado.reason}"`);
            return {
                matches: resultado.matches,
                similarity: resultado.similarity,
                torrentMetadata: metadados,
                reason: resultado.reason
            };
        }
        catch (erro) {
            this.logger.error('Erro na comparação', {
                tituloTorrent: tituloTorrent.substring(0, 60),
                imdbId,
                erro: erro instanceof Error ? erro.message : 'Erro'
            });
            return {
                matches: false,
                similarity: 0,
                torrentMetadata: this.extrairMetadados(tituloTorrent),
                reason: `Erro: ${erro instanceof Error ? erro.message : 'Erro'}`
            };
        }
    }
}
exports.TitleFilter = TitleFilter;
