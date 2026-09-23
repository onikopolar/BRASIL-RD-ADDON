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
    async titulosCombinam(tituloTorrent, imdbId, temporadaAlvo, episodioAlvo, tituloParaIdioma, anoDoScraper, imdbTitles, htmlTitle, episodioTorrent, imdbConfirmed, years) {
        try {
            const metadados = this.extrairMetadados(tituloTorrent);
            const anoDoTitulo = (0, TechnicalWords_js_1.extrairAno)(tituloTorrent)?.[0];
            const anoDoTituloParaIdioma = tituloParaIdioma ? (0, TechnicalWords_js_1.extrairAno)(tituloParaIdioma)?.[0] : undefined;
            const anoTorrent = anoDoScraper || anoDoTitulo || anoDoTituloParaIdioma;
            const isCollection = (0, TechnicalWords_js_1.isCollectionTitle)(tituloTorrent);
            const yearsDoTitulo = (0, TechnicalWords_js_1.extrairAno)(tituloTorrent);
            const yearsEfetivos = (years && years.length > 0) ? years : yearsDoTitulo;
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
            this.logger.debug('TitleFilter: validação de ano', {
                tituloTorrent,
                anoTorrent,
                imdbAno: imdbTitles?.year,
                isCollection,
                years: yearsEfetivos,
                isYearInCollection,
                imdbConfirmed: imdbConfirmed ?? false,
            });
            if (!imdbConfirmed &&
                !isCollection &&
                !isYearInCollection &&
                anoTorrent !== undefined &&
                imdbTitles?.year !== undefined &&
                Math.abs(anoTorrent - imdbTitles.year) > 1) {
                return {
                    matches: false,
                    similarity: 0,
                    torrentMetadata: metadados,
                    reason: `Ano divergente: ${anoTorrent} vs ${imdbTitles.year}`
                };
            }
            if (imdbConfirmed &&
                !isCollection &&
                anoTorrent !== undefined &&
                imdbTitles?.year !== undefined &&
                Math.abs(anoTorrent - imdbTitles.year) > 1) {
                this.logger.debug(`SKIP_ANO_POR_IMDB_CONFIRMADO | "${tituloTorrent.substring(0, 50)}" | ano=${anoTorrent} imdbAno=${imdbTitles.year} diff=${Math.abs(anoTorrent - imdbTitles.year)}`);
            }
            if (isCollection && isYearInCollection) {
                this.logger.info('Coleção/franquia aceita por faixa de anos', {
                    tituloTorrent,
                    imdbAno: imdbTitles?.year,
                    years: yearsEfetivos
                });
                return {
                    matches: true,
                    similarity: 0.8,
                    torrentMetadata: metadados,
                    reason: 'Coleção/franquia com ano na faixa'
                };
            }
            if (isCollection &&
                yearsEfetivos &&
                yearsEfetivos.length > 1 &&
                imdbTitles?.year !== undefined &&
                !isYearInCollection) {
                return {
                    matches: false,
                    similarity: 0,
                    torrentMetadata: metadados,
                    reason: `Coleção ${yearsEfetivos.join('-')} não contém ${imdbTitles.year}`
                };
            }
            const tituloParaRange = tituloTorrent || htmlTitle || tituloParaIdioma;
            let range = tituloParaRange ? (0, TechnicalWords_js_1.extrairRangeEpisodios)(tituloParaRange) : null;
            if (!range && htmlTitle) {
                range = (0, TechnicalWords_js_1.extrairRangeEpisodios)(htmlTitle);
            }
            if (!range && tituloParaIdioma) {
                range = (0, TechnicalWords_js_1.extrairRangeEpisodios)(tituloParaIdioma);
            }
            if (episodioAlvo !== undefined) {
                const temRange = range && range.episodeStart > 0 && range.episodeEnd > 0;
                if (temRange) {
                    if (episodioAlvo < range.episodeStart || episodioAlvo > range.episodeEnd) {
                        return {
                            matches: false,
                            similarity: 0,
                            torrentMetadata: metadados,
                            reason: `Episódio fora do range: E${episodioAlvo} vs E${range.episodeStart}-E${range.episodeEnd}`
                        };
                    }
                }
                else if (episodioTorrent !== undefined && episodioTorrent > 0) {
                    if (episodioTorrent !== episodioAlvo) {
                        return {
                            matches: false,
                            similarity: 0,
                            torrentMetadata: metadados,
                            reason: `Episódio diferente: E${episodioTorrent} vs alvo E${episodioAlvo}`
                        };
                    }
                }
                else {
                    const isSeasonPack = range && range.seasonStart > 0 && range.episodeStart === 0 && range.episodeEnd === 0;
                    if (isSeasonPack && temporadaAlvo !== undefined && (0, TechnicalWords_js_1.temporadaAlvoNoRange)(range, temporadaAlvo)) {
                    }
                }
            }
            if (range && temporadaAlvo !== undefined && !(0, TechnicalWords_js_1.temporadaAlvoNoRange)(range, temporadaAlvo)) {
                return {
                    matches: false,
                    similarity: 0,
                    torrentMetadata: metadados,
                    reason: `Temporada diferente: S${range.seasonStart}-S${range.seasonEnd} vs S${temporadaAlvo}`
                };
            }
            if (imdbConfirmed && !isCollection) {
                this.logger.debug(`IMDB_CONFIRMADO_SKIP_SIMILARITY | torrent="${tituloTorrent.substring(0, 50)}" | imdbId=${imdbId}`);
                return {
                    matches: true,
                    similarity: 0.9,
                    torrentMetadata: metadados,
                    reason: 'IMDb confirmado no post'
                };
            }
            const seasonParaSimilaridade = temporadaAlvo;
            this.logger.debug(`TITLEFILTER_REPASSA | torrent="${tituloTorrent.substring(0, 50)}" | year=${anoTorrent ?? '-'} | years=[${yearsEfetivos?.join(',') ?? '-'}] | imdbAno=${imdbTitles?.year ?? '-'} | isYearInCollection=${isYearInCollection}`);
            const resultado = await this.similarityCalculator.smartTitleContainsCheck(tituloTorrent, imdbId, { year: anoTorrent, season: seasonParaSimilaridade, years: yearsEfetivos }, tituloParaIdioma, imdbTitles ?? undefined);
            if (resultado.mediaType === 'movie' && this.episodeMatcher.temIndicadorTemporada(tituloTorrent)) {
                return {
                    matches: false,
                    similarity: 0,
                    torrentMetadata: metadados,
                    reason: 'Torrent é série, mas TMDB diz que é filme'
                };
            }
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
