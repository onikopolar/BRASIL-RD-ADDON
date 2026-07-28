export interface EpisodeInfo {
  season: number;
  episode: number;
  rawMatch: string;
}

export interface RequestEpisodeInfo {
  season: number;
  episode: number;
  isValid: boolean;
}

export class EpisodeMatcher {
  private static instance: EpisodeMatcher;

  public static getInstance(): EpisodeMatcher {
    if (!EpisodeMatcher.instance) EpisodeMatcher.instance = new EpisodeMatcher();
    return EpisodeMatcher.instance;
  }

  private readonly episodePatterns: RegExp[] = [
    /(\d+)x(\d+)/i,
    /s(\d+)e(\d+)/i,
    /season[\s\._-]?(\d+)[\s\._-]?episode[\s\._-]?(\d+)/i,
    /temporada[\s\._-]?(\d+)[\s\._-]?epis[oó]dio[\s\._-]?(\d+)/i,  // NOVO PADRÃO
    /ep[\s\._-]?(\d+)/i,
    /(\d+)(?:\s*-\s*|\s*)(\d+)/,
    /^(\d+)$/
  ];

  extractEpisodeInfo(filename: string): EpisodeInfo {
    // Extrai apenas o nome do arquivo (ignora caminho de pasta)
    // Ex: "Pasta/S02E01-02-03/S02E03.mkv" → "S02E03.mkv"
    const nomeArquivo = filename.includes('/')
      ? filename.split('/').pop() || filename
      : filename.includes('\\')
        ? filename.split('\\').pop() || filename
        : filename;

    for (const pattern of this.episodePatterns) {
      const match = nomeArquivo.match(pattern);
      if (match) {
        let season = 1;
        let episode = 0;

        // Determinar qual padrão foi encontrado
        if (pattern.source === '(\\d+)x(\\d+)') {
          // Formato 1x01
          season = parseInt(match[1]);
          episode = parseInt(match[2]);
        } else if (pattern.source === 's(\\d+)e(\\d+)') {
          // Formato S01E01
          season = parseInt(match[1]);
          episode = parseInt(match[2]);
        } else if (pattern.source.includes('season') && pattern.source.includes('episode')) {
          // Formato Season X Episode Y
          season = parseInt(match[1]);
          episode = parseInt(match[2]);
        } else if (pattern.source.includes('temporada') && pattern.source.includes('epis')) {
          // Formato Temporada X Episodio Y
          season = parseInt(match[1]);
          episode = parseInt(match[2]);
        } else if (pattern.source.includes('ep')) {
          // Formato Ep XX
          episode = parseInt(match[1]);
        } else if (pattern.source === '^(\\d+)$') {
          // Apenas número
          episode = parseInt(match[1]);
        } else if (match.length >= 3) {
          // Outros padrões com dois grupos
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

    const fallbackMatch = nomeArquivo.match(/\d+/);
    const fallbackNumber = fallbackMatch ? parseInt(fallbackMatch[0]) : 0;

    return {
      season: 1,
      episode: fallbackNumber,
      rawMatch: fallbackMatch ? fallbackMatch[0] : 'unknown'
    };
  }

  extractEpisodeFromRequest(requestId: string): RequestEpisodeInfo {
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

  extractSeasonFromTitle(title: string): number | null {
    const patterns = [
      /temporada\s*(\d+)/i,
      /(\d+)\s*ª?\s*temporada/i,     // "2ª temporada", "2 temporada"
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

  compareEpisodeInfo(a: EpisodeInfo, b: EpisodeInfo): number {
    if (a.season !== b.season) {
      return a.season - b.season;
    }
    
    if (a.episode !== b.episode) {
      return a.episode - b.episode;
    }
    
    return 0;
  }

  getSeasonCacheKey(imdbId: string, season: number): string {
    return `season:${imdbId}:${season}`;
  }

  extractEpisodeFromMultipleSources(
    requestId: string, 
    torrentTitle?: string
  ): RequestEpisodeInfo {
    // 1. Primeiro tenta do request ID (formato tt:season:episode)
    const fromRequest = this.extractEpisodeFromRequest(requestId);
    if (fromRequest.isValid) {
      return fromRequest;
    }
    
    // 2. Se tem título do torrent, tenta dele
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
    
    // 3. Fallback (mas marca como não válido)
    return { season: 1, episode: 1, isValid: false };
  }

  // ═══════════════════════════════════════════════════════════════
  // MÉTODOS MOVIDOS DO TITLEFILTER — Validação de temporada/episódio
  // ═══════════════════════════════════════════════════════════════

  /** Verifica se o título contém algum indicador de temporada */
  temIndicadorTemporada(titulo: string): boolean {
    const lower = titulo.toLowerCase();
    const padroes = [
      /\bs\d{1,3}\b/,              // S01, S1
      /\bseason\s*\d{1,3}\b/,      // Season 1, season01
      /\bt\d{1,3}\b/,              // T1, T01 (usado em sites BR)
      /\btemporada\s*\d{1,3}\b/,   // Temporada 1
      /\b\d{1,2}ª?\s*temporada\b/  // 1ª temporada
    ];
    return padroes.some(p => p.test(lower));
  }

  /** Verifica se o título contém indicador de episódio específico */
  temIndicadorEpisodio(titulo: string): boolean {
    const lower = titulo.toLowerCase();
    return /s\d+e\d+/i.test(lower) || /episode\s+\d+/i.test(lower) || /\be\d{1,3}\b/i.test(lower);
  }

  /** Pack de temporada: tem indicador de temporada SEM indicador de episódio */
  ehPackTemporadaCompleta(titulo: string): boolean {
    return this.temIndicadorTemporada(titulo) && !this.temIndicadorEpisodio(titulo);
  }

  /** Detecta ranges de episódios: E01-E05, E01E02E03, etc. */
  temMultiplosEpisodios(titulo: string): { temMultiplos: boolean; episodioInicio?: number; episodioFim?: number } {
    const lower = titulo.toLowerCase();
    // Range: E01-E05 ou E01-E02-E03
    const rangeMatch = lower.match(/e(\d{1,10})-(\d{1,10})(?:-(\d{1,10}))?(?:-(\d{1,10}))?/);
    if (rangeMatch) {
      const inicio = parseInt(rangeMatch[1]);
      let fim = inicio;
      for (let i = 2; i <= 4; i++) if (rangeMatch[i]) fim = parseInt(rangeMatch[i]);
      return { temMultiplos: true, episodioInicio: inicio, episodioFim: fim };
    }
    // Concatenação: E01E02E03
    const concatMatch = lower.match(/e(\d{1,10})e(\d{1,10})(?:e(\d{1,10}))?(?:e(\d{1,10}))?/);
    if (concatMatch) {
      const inicio = parseInt(concatMatch[1]);
      let fim = inicio;
      for (let i = 2; i <= 4; i++) if (concatMatch[i]) fim = parseInt(concatMatch[i]);
      return { temMultiplos: true, episodioInicio: inicio, episodioFim: fim };
    }
    return { temMultiplos: false };
  }

  /** 
   * Valida se o episódio do torrent é compatível com o episódio alvo.
   * Considera packs de temporada, ranges de episódios e episódios específicos.
   */
  episodioEhCompativel(
    tituloTorrent: string,
    episodioTorrent: number | undefined,
    episodioAlvo: number,
    temporadaAlvo: number
  ): { compativel: boolean; motivo: string } {
    // 1. Pack de temporada explícito (sem episódio) → aceita qualquer episódio
    if (this.ehPackTemporadaCompleta(tituloTorrent)) {
      return { compativel: true, motivo: 'Pack de temporada (sem episódio específico)' };
    }

    // 2. Range de episódios (ex: E01-E05)
    const multiplos = this.temMultiplosEpisodios(tituloTorrent);
    if (multiplos.temMultiplos && multiplos.episodioInicio && multiplos.episodioFim) {
      if (episodioAlvo >= multiplos.episodioInicio && episodioAlvo <= multiplos.episodioFim) {
        return { compativel: true, motivo: `Episódio ${episodioAlvo} no range ${multiplos.episodioInicio}-${multiplos.episodioFim}` };
      }
      return { compativel: false, motivo: `Episódio ${episodioAlvo} fora do range ${multiplos.episodioInicio}-${multiplos.episodioFim}` };
    }

    // 3. Episódio indefinido no torrent, mas tem indicador de temporada sem episódio → provável pack
    if (episodioTorrent === undefined) {
      if (this.temIndicadorTemporada(tituloTorrent) && !this.temIndicadorEpisodio(tituloTorrent)) {
        return { compativel: true, motivo: 'Provável pack de temporada (sem episódio)' };
      }
      return { compativel: false, motivo: 'Episódio não especificado' };
    }

    // 4. Episódio específico corresponde
    if (episodioTorrent === episodioAlvo) {
      return { compativel: true, motivo: `Episódio específico ${episodioAlvo} corresponde` };
    }

    return { compativel: false, motivo: `Episódio diferente: Torrent E${episodioTorrent} vs E${episodioAlvo}` };
  }

}