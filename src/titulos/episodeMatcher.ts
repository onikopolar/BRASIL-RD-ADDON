import { extrairRangeEpisodios, normalizarTexto } from './TechnicalWords.js';

export interface EpisodeInfo {
  season: number;
  episode: number;
  rawMatch: string;
}

export class EpisodeMatcher {
  private static instance: EpisodeMatcher;

  public static getInstance(): EpisodeMatcher {
    if (!EpisodeMatcher.instance) EpisodeMatcher.instance = new EpisodeMatcher();
    return EpisodeMatcher.instance;
  }

  // ─── CONSTANTES ───

  /** Extensões de arquivo de vídeo conhecidas */
  private readonly extensoesVideo: ReadonlySet<string> = new Set([
    '.mkv', '.mp4', '.avi', '.webm', '.mov', '.wmv', '.flv', '.ts', '.m4v',
  ]);

  // ═══════════════════════════════════════════
  // PERGUNTA BINÁRIA (V2 — genérica)
  // ═══════════════════════════════════════════

  /**
   * Pergunta binária: este arquivo (path completo do Torbox) pertence
   * ao episódio alvo?
   */
  arquivoPertenceAoEpisodio(
    caminhoCompleto: string,
    temporadaAlvo: number,
    episodioAlvo: number
  ): boolean {
    if (!this.ehArquivoDeVideo(caminhoCompleto)) return false;

    const normalizado = normalizarTexto(caminhoCompleto);

    const range = extrairRangeEpisodios(normalizado);
    if (range && range.season > 0 && range.episodeStart > 0) {
      return range.season === temporadaAlvo && range.episodeStart === episodioAlvo;
    }

    const sinal = normalizado;
    const numeros = sinal.match(/\d+/g);
    if (numeros && numeros.length >= 2) {
      const s = parseInt(numeros[0]);
      const e = parseInt(numeros[1]);
      return s === temporadaAlvo && e === episodioAlvo;
    }

    return false;
  }

  // ─── MÉTODOS PRIVADOS ───

  private ehArquivoDeVideo(caminho: string): boolean {
    const lower = caminho.toLowerCase();
    for (const ext of this.extensoesVideo) {
      if (lower.endsWith(ext)) return true;
    }
    return false;
  }

  // ═══════════════════════════════════════════
  // EXTRAÇÃO LEGADA (mantida por compatibilidade)
  // ═══════════════════════════════════════════

  extractEpisodeInfo(filename: string): EpisodeInfo {
    const nomeArquivo = this.extrairNomeArquivo(filename);
    const normalizado = normalizarTexto(nomeArquivo);

    const range = extrairRangeEpisodios(normalizado);
    if (range && range.season > 0 && range.episodeStart > 0) {
      return {
        season: range.season,
        episode: range.episodeStart,
        rawMatch: `S${String(range.season).padStart(2, '0')}E${String(range.episodeStart).padStart(2, '0')}`
      };
    }

    const numeros = normalizado.match(/\d+/g);
    if (numeros && numeros.length >= 2) {
      return {
        season: parseInt(numeros[0]),
        episode: parseInt(numeros[1]),
        rawMatch: numeros.slice(0, 2).join(' ')
      };
    }

    const fallbackMatch = nomeArquivo.match(/\d+/);
    const fallbackNumber = fallbackMatch ? parseInt(fallbackMatch[0]) : 0;
    return { season: 1, episode: fallbackNumber, rawMatch: fallbackMatch ? fallbackMatch[0] : 'unknown' };
  }

  extractSeasonFromTitle(title: string): number | null {
    const range = extrairRangeEpisodios(title);
    if (range && range.season > 0) {
      return range.season;
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════
  // INDICADORES E VALIDAÇÃO (usados por outros módulos)
  // ═══════════════════════════════════════════════════════════════

  temIndicadorTemporada(titulo: string): boolean {
    const lower = titulo.toLowerCase();
    const padroes = [
      /\bs\d{1,3}\b/,
      /\bseason\s*\d{1,3}\b/,
      /\bt\d{1,3}\b/,
      /\btemporada\s*\d{1,3}\b/,
      /\b\d{1,2}ª?\s*temporada\b/,
      /\b\d{1,2}x\d{1,3}\b/,
    ];
    return padroes.some(p => p.test(lower));
  }

  temIndicadorEpisodio(titulo: string): boolean {
    const lower = titulo.toLowerCase();
    return /s\d+e\d+/i.test(lower) || /episode\s+\d+/i.test(lower) || /\be\d{1,3}\b/i.test(lower);
  }

  ehPackTemporadaCompleta(titulo: string): boolean {
    return this.temIndicadorTemporada(titulo) && !this.temIndicadorEpisodio(titulo);
  }

  temMultiplosEpisodios(titulo: string): { temMultiplos: boolean; episodioInicio?: number; episodioFim?: number } {
    const range = extrairRangeEpisodios(titulo);
    if (range && range.episodeStart > 0 && range.episodeEnd > range.episodeStart) {
      return { temMultiplos: true, episodioInicio: range.episodeStart, episodioFim: range.episodeEnd };
    }
    return { temMultiplos: false };
  }

  episodioEhCompativel(
    tituloTorrent: string,
    episodioTorrent: number | undefined,
    episodioAlvo: number,
    temporadaAlvo: number
  ): { compativel: boolean; motivo: string } {
    if (this.ehPackTemporadaCompleta(tituloTorrent)) {
      return { compativel: true, motivo: 'Pack de temporada (sem episódio específico)' };
    }

    const range = extrairRangeEpisodios(tituloTorrent);
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

  // ─── MÉTODO AUXILIAR ───

  private extrairNomeArquivo(path: string): string {
    return path.includes('/')
      ? path.split('/').pop() || path
      : path.includes('\\')
        ? path.split('\\').pop() || path
        : path;
  }
}