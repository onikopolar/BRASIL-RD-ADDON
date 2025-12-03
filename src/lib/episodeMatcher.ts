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
    for (const pattern of this.episodePatterns) {
      const match = filename.match(pattern);
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

    const fallbackMatch = filename.match(/\d+/);
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
      /(\d+)\s*temporada/i,
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

}