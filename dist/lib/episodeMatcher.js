"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EpisodeMatcher = void 0;
class EpisodeMatcher {
    constructor() {
        this.episodePatterns = [
            /(\d+)x(\d+)/i,
            /s(\d+)e(\d+)/i,
            /season[\s\._-]?(\d+)[\s\._-]?episode[\s\._-]?(\d+)/i,
            /temporada[\s\._-]?(\d+)[\s\._-]?epis[oó]dio[\s\._-]?(\d+)/i,
            /ep[\s\._-]?(\d+)/i,
            /(\d+)(?:\s*-\s*|\s*)(\d+)/,
            /^(\d+)$/
        ];
    }
    static getInstance() {
        if (!EpisodeMatcher.instance)
            EpisodeMatcher.instance = new EpisodeMatcher();
        return EpisodeMatcher.instance;
    }
    extractEpisodeInfo(filename) {
        for (const pattern of this.episodePatterns) {
            const match = filename.match(pattern);
            if (match) {
                let season = 1;
                let episode = 0;
                if (pattern.source === '(\\d+)x(\\d+)') {
                    season = parseInt(match[1]);
                    episode = parseInt(match[2]);
                }
                else if (pattern.source === 's(\\d+)e(\\d+)') {
                    season = parseInt(match[1]);
                    episode = parseInt(match[2]);
                }
                else if (pattern.source.includes('season') && pattern.source.includes('episode')) {
                    season = parseInt(match[1]);
                    episode = parseInt(match[2]);
                }
                else if (pattern.source.includes('temporada') && pattern.source.includes('epis')) {
                    season = parseInt(match[1]);
                    episode = parseInt(match[2]);
                }
                else if (pattern.source.includes('ep')) {
                    episode = parseInt(match[1]);
                }
                else if (pattern.source === '^(\\d+)$') {
                    episode = parseInt(match[1]);
                }
                else if (match.length >= 3) {
                    season = parseInt(match[1]);
                    episode = parseInt(match[2]);
                }
                if (!isNaN(season) && !isNaN(episode) && season > 0 && episode > 0) {
                    return {
                        season,
                        episode,
                        rawMatch: match[0]
                    };
                }
            }
        }
        const fallbackMatch = filename.match(/\d+/);
        const fallbackNumber = fallbackMatch ? parseInt(fallbackMatch[0]) : 0;
        return {
            season: 1,
            episode: fallbackNumber,
            rawMatch: fallbackMatch ? fallbackMatch[0] : 'unknown'
        };
    }
    extractEpisodeFromRequest(requestId) {
        const defaultResult = { season: 1, episode: 1, isValid: false };
        if (!requestId || typeof requestId !== 'string') {
            return defaultResult;
        }
        const match = requestId.match(/tt\d+:(\d+):(\d+)/);
        if (!match) {
            return defaultResult;
        }
        const season = parseInt(match[1]);
        const episode = parseInt(match[2]);
        if (isNaN(season) || isNaN(episode) || season < 1 || episode < 1) {
            return defaultResult;
        }
        return {
            season,
            episode,
            isValid: true
        };
    }
    extractSeasonFromTitle(title) {
        const patterns = [
            /temporada\s*(\d+)/i,
            /(\d+)\s*ª?\s*temporada/i,
            /season\s*(\d+)/i,
            /s(\d+)/i,
            /(\d+)\s*ª?\s*temp/i
        ];
        for (const pattern of patterns) {
            const match = title.match(pattern);
            if (match) {
                const season = parseInt(match[1]);
                if (!isNaN(season) && season > 0) {
                    return season;
                }
            }
        }
        return null;
    }
    compareEpisodeInfo(a, b) {
        if (a.season !== b.season) {
            return a.season - b.season;
        }
        if (a.episode !== b.episode) {
            return a.episode - b.episode;
        }
        return 0;
    }
    getSeasonCacheKey(imdbId, season) {
        return `season:${imdbId}:${season}`;
    }
    extractEpisodeFromMultipleSources(requestId, torrentTitle) {
        const fromRequest = this.extractEpisodeFromRequest(requestId);
        if (fromRequest.isValid) {
            return fromRequest;
        }
        if (torrentTitle) {
            const fromTitle = this.extractEpisodeInfo(torrentTitle);
            if (fromTitle.season > 0 && fromTitle.episode > 0) {
                return {
                    season: fromTitle.season,
                    episode: fromTitle.episode,
                    isValid: true
                };
            }
        }
        return { season: 1, episode: 1, isValid: false };
    }
    temIndicadorTemporada(titulo) {
        const lower = titulo.toLowerCase();
        const padroes = [
            /\bs\d{1,3}\b/,
            /\bseason\s*\d{1,3}\b/,
            /\bt\d{1,3}\b/,
            /\btemporada\s*\d{1,3}\b/,
            /\b\d{1,2}ª?\s*temporada\b/
        ];
        return padroes.some(p => p.test(lower));
    }
    temIndicadorEpisodio(titulo) {
        const lower = titulo.toLowerCase();
        return /s\d+e\d+/i.test(lower) || /episode\s+\d+/i.test(lower) || /\be\d{1,3}\b/i.test(lower);
    }
    ehPackTemporadaCompleta(titulo) {
        return this.temIndicadorTemporada(titulo) && !this.temIndicadorEpisodio(titulo);
    }
    temMultiplosEpisodios(titulo) {
        const lower = titulo.toLowerCase();
        const rangeMatch = lower.match(/e(\d{1,10})-(\d{1,10})(?:-(\d{1,10}))?(?:-(\d{1,10}))?/);
        if (rangeMatch) {
            const inicio = parseInt(rangeMatch[1]);
            let fim = inicio;
            for (let i = 2; i <= 4; i++)
                if (rangeMatch[i])
                    fim = parseInt(rangeMatch[i]);
            return { temMultiplos: true, episodioInicio: inicio, episodioFim: fim };
        }
        const concatMatch = lower.match(/e(\d{1,10})e(\d{1,10})(?:e(\d{1,10}))?(?:e(\d{1,10}))?/);
        if (concatMatch) {
            const inicio = parseInt(concatMatch[1]);
            let fim = inicio;
            for (let i = 2; i <= 4; i++)
                if (concatMatch[i])
                    fim = parseInt(concatMatch[i]);
            return { temMultiplos: true, episodioInicio: inicio, episodioFim: fim };
        }
        return { temMultiplos: false };
    }
    episodioEhCompativel(tituloTorrent, episodioTorrent, episodioAlvo, temporadaAlvo) {
        if (this.ehPackTemporadaCompleta(tituloTorrent)) {
            return { compativel: true, motivo: 'Pack de temporada (sem episódio específico)' };
        }
        const multiplos = this.temMultiplosEpisodios(tituloTorrent);
        if (multiplos.temMultiplos && multiplos.episodioInicio && multiplos.episodioFim) {
            if (episodioAlvo >= multiplos.episodioInicio && episodioAlvo <= multiplos.episodioFim) {
                return { compativel: true, motivo: `Episódio ${episodioAlvo} no range ${multiplos.episodioInicio}-${multiplos.episodioFim}` };
            }
            return { compativel: false, motivo: `Episódio ${episodioAlvo} fora do range ${multiplos.episodioInicio}-${multiplos.episodioFim}` };
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
}
exports.EpisodeMatcher = EpisodeMatcher;
