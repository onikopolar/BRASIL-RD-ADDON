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

  private readonly extensoesVideo: ReadonlySet<string> = new Set([
    '.mkv', '.mp4', '.avi', '.webm', '.mov', '.wmv', '.flv', '.ts', '.m4v',
  ]);

  arquivoPertenceAoEpisodio(
    caminhoCompleto: string,
    temporadaAlvo: number,
    episodioAlvo: number
  ): boolean {
    if (!this.ehArquivoDeVideo(caminhoCompleto)) return false;

    // Extrai só o nome do arquivo — senão o primeiro SxxExx vem da pasta (pack S01E01-02-03)
    const nomeArquivo = this.extrairNomeArquivo(caminhoCompleto);
    const range = extrairRangeEpisodios(nomeArquivo);
    return (
      range !== null &&
      range.seasonStart === temporadaAlvo &&
      range.episodeStart === episodioAlvo &&
      range.episodeEnd === episodioAlvo
    );
  }

  arquivoPertenceAoEpisodioComTitulos(
    caminhoCompleto: string,
    temporadaAlvo: number,
    episodioAlvo: number,
    episodeTitles?: Array<{ episodeNumber: number; namePt?: string; nameEn?: string }> | null
  ): boolean {
    if (!this.ehArquivoDeVideo(caminhoCompleto)) return false;

    if (episodeTitles && episodeTitles.length > 0) {
      const epData = episodeTitles.find(ep => ep.episodeNumber === episodioAlvo);
      if (epData) {
        const nomeArquivo = normalizarTexto(
          this.extrairNomeArquivo(caminhoCompleto)
            .toLowerCase()
            .replace(/\.[^.]+$/, '')
        );
        const nomesNormalizados = [epData.namePt, epData.nameEn]
          .filter((n): n is string => !!n)
          .map(n => normalizarTexto(n));

        if (nomesNormalizados.some(nome => nomeArquivo.includes(nome) || nome.includes(nomeArquivo))) {
          return true;
        }

        return this.arquivoPertenceAoEpisodio(caminhoCompleto, temporadaAlvo, episodioAlvo);
      }
    }

    return this.arquivoPertenceAoEpisodio(caminhoCompleto, temporadaAlvo, episodioAlvo);
  }

  extractEpisodeInfo(filename: string): EpisodeInfo {
    const range = extrairRangeEpisodios(filename);

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

  extractSeasonFromTitle(title: string): number | null {
    const range = extrairRangeEpisodios(title);
    return range && range.seasonStart > 0 ? range.seasonStart : null;
  }

  temIndicadorTemporada(titulo: string): boolean {
    const range = extrairRangeEpisodios(titulo);
    if (range && range.seasonStart > 0) return true;

    const lower = normalizarTexto(titulo);
    return /temporada|season|\btemp\b|\btodas as temporadas\b/i.test(lower);
  }

  temIndicadorEpisodio(titulo: string): boolean {
    const range = extrairRangeEpisodios(titulo);
    if (range && range.episodeStart > 0) return true;

    const lower = normalizarTexto(titulo);
    return /epis[oó]dio|\be\d{1,3}\b|episode/i.test(lower);
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

  private ehArquivoDeVideo(caminho: string): boolean {
    const lower = caminho.toLowerCase();
    for (const ext of this.extensoesVideo) {
      if (lower.endsWith(ext)) return true;
    }
    return false;
  }

  private extrairNomeArquivo(path: string): string {
    return path.includes('/')
      ? path.split('/').pop() || path
      : path.includes('\\')
        ? path.split('\\').pop() || path
        : path;
  }
}