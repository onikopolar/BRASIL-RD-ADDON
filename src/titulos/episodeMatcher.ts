export interface EpisodeInfo {
  season: number;
  episode: number;
  rawMatch: string;
}

import { isTechnicalWord } from './TechnicalWords.js';

export class EpisodeMatcher {
  private static instance: EpisodeMatcher;

  public static getInstance(): EpisodeMatcher {
    if (!EpisodeMatcher.instance) EpisodeMatcher.instance = new EpisodeMatcher();
    return EpisodeMatcher.instance;
  }

  // ─── CONSTANTES ───

  /** Extensoes de arquivo de video conhecidas */
  private readonly extensoesVideo: ReadonlySet<string> = new Set([
    '.mkv', '.mp4', '.avi', '.webm', '.mov', '.wmv', '.flv', '.ts', '.m4v',
  ]);

  // ═══════════════════════════════════════════
  // NOVO: pergunta binaria (V2 — generico, sem hacks)
  // ═══════════════════════════════════════════

  /**
   * Pergunta binaria: este arquivo (path completo do Torbox) pertence
   * ao episodio alvo?
   *
   * Diferente de extractEpisodeInfo: aqui nao extraimos — respondemos
   * SIM ou NAO direto. Usa "ultimo SxxExx na string" pra ignorar
   * prefixo de pasta naturalmente, sem split('/').
   */
  arquivoPertenceAoEpisodio(
    caminhoCompleto: string,
    temporadaAlvo: number,
    episodioAlvo: number
  ): boolean {
    // 1) So processa arquivos de video
    if (!this.ehArquivoDeVideo(caminhoCompleto)) return false;

    const normalizado = caminhoCompleto.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // 2) Metodo primario: ultimo SxxExx no path cru
    const { temporada, episodio } = this.extrairDoUltimoSxxExx(normalizado);
    if (temporada > 0 && episodio > 0) {
      return temporada === temporadaAlvo && episodio === episodioAlvo;
    }

    // 3) Fallback: NxNN (ex: 5x12)
    const nx = this.extrairDoUltimoNxNN(normalizado);
    if (nx.temporada > 0 && nx.episodio > 0) {
      return nx.temporada === temporadaAlvo && nx.episodio === episodioAlvo;
    }

    // 4) Fallback via ruido-strip (Season X Episode Y etc)
    const sinal = this.limparRuido(normalizado);
    const doSinal = this.extrairDoUltimoSxxExx(sinal);
    if (doSinal.temporada > 0 && doSinal.episodio > 0) {
      return doSinal.temporada === temporadaAlvo && doSinal.episodio === episodioAlvo;
    }

    // 5) Fallback numerico: primeiros 2 numeros do sinal = season, episode
    const numeros = sinal.match(/\d+/g);
    if (numeros && numeros.length >= 2) {
      const s = parseInt(numeros[0]);
      const e = parseInt(numeros[1]);
      return s === temporadaAlvo && e === episodioAlvo;
    }

    return false;
  }

  // ─── METODOS PRIVADOS (V2) ───

  /** Verifica se o caminho termina com extensao de video conhecida */
  private ehArquivoDeVideo(caminho: string): boolean {
    const lower = caminho.toLowerCase();
    for (const ext of this.extensoesVideo) {
      if (lower.endsWith(ext)) return true;
    }
    return false;
  }

  /**
   * Encontra TODOS os padroes SxxExx na string e extrai
   * season/episode do ULTIMO match.
   *
   * O ultimo match naturalmente pertence ao nome do arquivo,
   * nao ao prefixo da pasta — sem precisar de split('/').
   */
  private extrairDoUltimoSxxExx(texto: string): { temporada: number; episodio: number } {
    const matches = texto.match(/s(\d+)[ex](\d+)/gi);
    if (!matches || matches.length === 0) return { temporada: 0, episodio: 0 };

    const ultimo = matches[matches.length - 1];
    const parsed = ultimo.match(/s?(\d+)[ex](\d+)/i);
    if (!parsed) return { temporada: 0, episodio: 0 };

    const temporada = parseInt(parsed[1]);
    const episodio = parseInt(parsed[2]);
    return { temporada, episodio };
  }

  /** Fallback: formato 5x12 */
  private extrairDoUltimoNxNN(texto: string): { temporada: number; episodio: number } {
    const matches = texto.match(/(\d+)x(\d+)/gi);
    if (!matches || matches.length === 0) return { temporada: 0, episodio: 0 };

    const ultimo = matches[matches.length - 1];
    const parsed = ultimo.match(/(\d+)x(\d+)/i);
    if (!parsed) return { temporada: 0, episodio: 0 };

    return { temporada: parseInt(parsed[1]), episodio: parseInt(parsed[2]) };
  }

  /**
   * Remove ruido tecnico do texto usando isTechnicalWord().
   * Preserva tokens estruturais (SxxExx, NxNN, numeros puros, palavras
   * de season/episodio) via regex — sem listas novas, sem duplicacao.
   */
  private limparRuido(texto: string): string {
    const normalizado = texto
      .replace(/[^\w\s.]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const tokensEspaco = normalizado.split(' ');
    const todosTokens = new Set<string>();
    for (const t of tokensEspaco) {
      todosTokens.add(t);
      t.split('.').forEach(sub => todosTokens.add(sub));
    }

    const sinal: string[] = [];
    for (const token of todosTokens) {
      // Preserva tokens que indicam estrutura de episodio
      if (/^s?\d+[ex]\d+$/i.test(token)) { sinal.push(token); continue; }  // S02E03, 5x12
      if (/^\d{1,2}$/.test(token))      { sinal.push(token); continue; }  // numeros puros (season/ep avulsos)
      if (/^(season|episode|temporada|epis[oó]dio|cap|capitulo|chapter)$/i.test(token)) { sinal.push(token); continue; }
      if (/^(s|e|ep|x)\d{1,2}$/i.test(token)) { sinal.push(token); continue; }  // s2, e3, ep4

      // Remove ruido via TECHNICAL_WORDS (fonte unica)
      if (!isTechnicalWord(token)) {
        sinal.push(token);
      }
    }

    return sinal.join(' ');
  }

  // ═══════════════════════════════════════════
  // METODOS LEGADOS (mantidos por compatibilidade)
  // ═══════════════════════════════════════════

  extractEpisodeInfo(filename: string): EpisodeInfo {
    // Extrai apenas o nome do arquivo
    const nomeArquivo = filename.includes('/')
      ? filename.split('/').pop() || filename
      : filename.includes('\\')
        ? filename.split('\\').pop() || filename
        : filename;

    const normalizado = nomeArquivo.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Usa os mesmos metodos do V2 (extrairDoUltimoSxxExx, NxNN, limparRuido)
    const sxe = this.extrairDoUltimoSxxExx(normalizado);
    if (sxe.temporada > 0 && sxe.episodio > 0) {
      return { season: sxe.temporada, episode: sxe.episodio, rawMatch: `S${sxe.temporada.toString().padStart(2, '0')}E${sxe.episodio.toString().padStart(2, '0')}` };
    }

    const nx = this.extrairDoUltimoNxNN(normalizado);
    if (nx.temporada > 0 && nx.episodio > 0) {
      return { season: nx.temporada, episode: nx.episodio, rawMatch: `${nx.temporada}x${nx.episodio.toString().padStart(2, '0')}` };
    }

    const sinal = this.limparRuido(normalizado);
    const doSinal = this.extrairDoUltimoSxxExx(sinal);
    if (doSinal.temporada > 0 && doSinal.episodio > 0) {
      return { season: doSinal.temporada, episode: doSinal.episodio, rawMatch: `S${doSinal.temporada}E${doSinal.episodio}` };
    }

    const numeros = sinal.match(/\d+/g);
    if (numeros && numeros.length >= 2) {
      return { season: parseInt(numeros[0]), episode: parseInt(numeros[1]), rawMatch: numeros.slice(0, 2).join(' ') };
    }

    const fallbackMatch = nomeArquivo.match(/\d+/);
    const fallbackNumber = fallbackMatch ? parseInt(fallbackMatch[0]) : 0;
    return { season: 1, episode: fallbackNumber, rawMatch: fallbackMatch ? fallbackMatch[0] : 'unknown' };
  }

  extractSeasonFromTitle(title: string): number | null {
    const patterns = [
      /(\d+)x\d+/i,                    // "8x262" → season 8
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