"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TitleFilter = void 0;
const logger_js_1 = require("../utils/logger.js");
const SimilarityCalculator_js_1 = require("./title-filter/SimilarityCalculator.js");
const MetadataExtractor_js_1 = require("./title-filter/MetadataExtractor.js");
const LanguageDetector_js_1 = require("./title-filter/LanguageDetector.js");
const episodeMatcher_js_1 = require("./episodeMatcher.js");
class TitleFilter {
    constructor() {
        this.logger = new logger_js_1.Logger('TitleFilter');
        this.similarityCalculator = SimilarityCalculator_js_1.SimilarityCalculator.getInstance();
        this.metadataExtractor = MetadataExtractor_js_1.MetadataExtractor.getInstance();
        this.languageDetector = LanguageDetector_js_1.LanguageDetector.getInstance();
        this.episodeMatcher = episodeMatcher_js_1.EpisodeMatcher.getInstance();
    }
    static getInstance() {
        if (!TitleFilter.instance)
            TitleFilter.instance = new TitleFilter();
        return TitleFilter.instance;
    }
    extrairMetadados(titulo) {
        return this.metadataExtractor.extractSeriesMetadata(titulo);
    }
    conteudoEmPortugues(titulo) {
        return this.languageDetector.isPortugueseContent(titulo);
    }
    extrairAno(titulo) {
        const m = titulo.match(/\b(19|20)\d{2}\b/);
        return m ? parseInt(m[0]) : undefined;
    }
    async titulosCombinam(tituloTorrent, imdbId, temporadaAlvo, episodioAlvo) {
        try {
            const metadados = this.extrairMetadados(tituloTorrent);
            const anoTorrent = this.extrairAno(tituloTorrent);
            if (temporadaAlvo !== undefined) {
                if (metadados.season && metadados.season !== temporadaAlvo) {
                    return {
                        matches: false, similarity: 0, torrentMetadata: metadados,
                        reason: `Temporada diferente: S${metadados.season} vs S${temporadaAlvo}`
                    };
                }
                if (episodioAlvo !== undefined) {
                    const compat = this.episodeMatcher.episodioEhCompativel(tituloTorrent, metadados.episode, episodioAlvo, temporadaAlvo);
                    if (!compat.compativel) {
                        this.logger.warn('Episódio incompatível', {
                            tituloTorrent: tituloTorrent.substring(0, 60), episodioAlvo, motivo: compat.motivo
                        });
                        return { matches: false, similarity: 0, torrentMetadata: metadados, reason: compat.motivo };
                    }
                }
            }
            const resultado = await this.similarityCalculator.smartTitleContainsCheck(tituloTorrent, imdbId, { year: anoTorrent, season: temporadaAlvo });
            return {
                matches: resultado.matches,
                similarity: resultado.similarity,
                torrentMetadata: metadados,
                reason: resultado.reason
            };
        }
        catch (erro) {
            this.logger.error('Erro na comparação', {
                tituloTorrent: tituloTorrent.substring(0, 60), imdbId,
                erro: erro instanceof Error ? erro.message : 'Erro'
            });
            return {
                matches: false, similarity: 0,
                torrentMetadata: this.extrairMetadados(tituloTorrent),
                reason: `Erro: ${erro instanceof Error ? erro.message : 'Erro'}`
            };
        }
    }
}
exports.TitleFilter = TitleFilter;
