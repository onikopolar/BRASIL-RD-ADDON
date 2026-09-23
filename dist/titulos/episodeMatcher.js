"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EpisodeMatcher = void 0;
const TechnicalWords_js_1 = require("./TechnicalWords.js");
class EpisodeMatcher {
    constructor() {
        this.extensoesVideo = new Set([
            '.mkv', '.mp4', '.avi', '.webm', '.mov', '.wmv', '.flv', '.ts', '.m4v',
        ]);
    }
    static getInstance() {
        if (!EpisodeMatcher.instance)
            EpisodeMatcher.instance = new EpisodeMatcher();
        return EpisodeMatcher.instance;
    }
    arquivoPertenceAoEpisodio(caminhoCompleto, temporadaAlvo, episodioAlvo) {
        if (!this.ehArquivoDeVideo(caminhoCompleto))
            return false;
        const nomeArquivo = this.extrairNomeArquivo(caminhoCompleto);
        const range = (0, TechnicalWords_js_1.extrairRangeEpisodios)(nomeArquivo);
        return (range !== null &&
            range.seasonStart === temporadaAlvo &&
            range.episodeStart === episodioAlvo &&
            range.episodeEnd === episodioAlvo);
    }
    arquivoPertenceAoEpisodioComTitulos(caminhoCompleto, temporadaAlvo, episodioAlvo, episodeTitles) {
        if (!this.ehArquivoDeVideo(caminhoCompleto))
            return false;
        if (episodeTitles && episodeTitles.length > 0) {
            const epData = episodeTitles.find(ep => ep.episodeNumber === episodioAlvo);
            if (epData) {
                const nomeArquivo = (0, TechnicalWords_js_1.normalizarTexto)(this.extrairNomeArquivo(caminhoCompleto)
                    .toLowerCase()
                    .replace(/\.[^.]+$/, ''));
                const nomesNormalizados = [epData.namePt, epData.nameEn]
                    .filter((n) => !!n)
                    .map(n => (0, TechnicalWords_js_1.normalizarTexto)(n));
                if (nomesNormalizados.some(nome => nomeArquivo.includes(nome) || nome.includes(nomeArquivo))) {
                    return true;
                }
                return this.arquivoPertenceAoEpisodio(caminhoCompleto, temporadaAlvo, episodioAlvo);
            }
        }
        return this.arquivoPertenceAoEpisodio(caminhoCompleto, temporadaAlvo, episodioAlvo);
    }
    extractEpisodeInfo(filename) {
        const range = (0, TechnicalWords_js_1.extrairRangeEpisodios)(filename);
        if (range && range.seasonStart > 0 && range.episodeStart > 0) {
            return {
                season: range.seasonStart,
                episode: range.episodeStart,
                rawMatch: `S${String(range.seasonStart).padStart(2, '0')}E${String(range.episodeStart).padStart(2, '0')}`,
            };
        }
        const fallbackMatch = filename.match(/\d+/);
        const fallbackNumber = fallbackMatch ? parseInt(fallbackMatch[0]) : 0;
        return {
            season: 1,
            episode: fallbackNumber,
            rawMatch: fallbackMatch ? fallbackMatch[0] : 'unknown',
        };
    }
    extractSeasonFromTitle(title) {
        const range = (0, TechnicalWords_js_1.extrairRangeEpisodios)(title);
        return range && range.seasonStart > 0 ? range.seasonStart : null;
    }
    temIndicadorTemporada(titulo) {
        const range = (0, TechnicalWords_js_1.extrairRangeEpisodios)(titulo);
        if (range && range.seasonStart > 0)
            return true;
        const lower = (0, TechnicalWords_js_1.normalizarTexto)(titulo);
        return /temporada|season|\btemp\b|\btodas as temporadas\b/i.test(lower);
    }
    temIndicadorEpisodio(titulo) {
        const range = (0, TechnicalWords_js_1.extrairRangeEpisodios)(titulo);
        if (range && range.episodeStart > 0)
            return true;
        const lower = (0, TechnicalWords_js_1.normalizarTexto)(titulo);
        return /epis[oó]dio|\be\d{1,3}\b|episode/i.test(lower);
    }
    ehPackTemporadaCompleta(titulo) {
        return this.temIndicadorTemporada(titulo) && !this.temIndicadorEpisodio(titulo);
    }
    temMultiplosEpisodios(titulo) {
        const range = (0, TechnicalWords_js_1.extrairRangeEpisodios)(titulo);
        if (range && range.episodeStart > 0 && range.episodeEnd > range.episodeStart) {
            return { temMultiplos: true, episodioInicio: range.episodeStart, episodioFim: range.episodeEnd };
        }
        return { temMultiplos: false };
    }
    episodioEhCompativel(tituloTorrent, episodioTorrent, episodioAlvo, temporadaAlvo) {
        if (this.ehPackTemporadaCompleta(tituloTorrent)) {
            return { compativel: true, motivo: 'Pack de temporada (sem episódio específico)' };
        }
        const range = (0, TechnicalWords_js_1.extrairRangeEpisodios)(tituloTorrent);
        if (range && range.episodeStart > 0 && range.episodeEnd > 0) {
            if (episodioAlvo >= range.episodeStart && episodioAlvo <= range.episodeEnd) {
                return { compativel: true, motivo: `Episódio ${episodioAlvo} no range ${range.episodeStart}-${range.episodeEnd}` };
            }
            return { compativel: false, motivo: `Episódio ${episodioAlvo} fora do range ${range.episodeStart}-${range.episodeEnd}` };
        }
        if (episodioTorrent === undefined) {
            if (this.temIndicadorTemporada(tituloTorrent) && !this.temIndicadorEpisodio(tituloTorrent)) {
                return { compativel: true, motivo: 'Provável pack de temporada (sem episódio)' };
            }
            return { compativel: false, motivo: 'Episódio não especificado' };
        }
        if (episodioTorrent === episodioAlvo) {
            return { compativel: true, motivo: `Episódio específico ${episodioAlvo} corresponde` };
        }
        return { compativel: false, motivo: `Episódio diferente: Torrent E${episodioTorrent} vs E${episodioAlvo}` };
    }
    ehArquivoDeVideo(caminho) {
        const lower = caminho.toLowerCase();
        for (const ext of this.extensoesVideo) {
            if (lower.endsWith(ext))
                return true;
        }
        return false;
    }
    extrairNomeArquivo(path) {
        return path.includes('/')
            ? path.split('/').pop() || path
            : path.includes('\\')
                ? path.split('\\').pop() || path
                : path;
    }
}
exports.EpisodeMatcher = EpisodeMatcher;
