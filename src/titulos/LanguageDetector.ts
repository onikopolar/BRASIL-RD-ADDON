import { Logger } from '../utils/logger.js';
import { ImdbScraperService } from '../catalogo/ImdbScraperService.js';
import {
  isTechnicalWord,
  isInternationalReleaseGroup,
  isBrazilianReleaseGroup,
} from './TechnicalWords.js';

/**
 * LanguageDetector — Detecta se um título de torrent está em Português.
 * 
 * Estratégia: loop único `for...of` que itera cada palavra do torrent
 * e verifica TODOS os contextos disponíveis (TMDB PT, TMDB EN, indicadores).
 * Nenhuma verificação fica de fora.
 */
export class LanguageDetector {
  private readonly logger = new Logger('LanguageDetector');
  private readonly imdbScraper = ImdbScraperService.getInstance();

  private static instance: LanguageDetector;

  public static getInstance(): LanguageDetector {
    if (!LanguageDetector.instance) {
      LanguageDetector.instance = new LanguageDetector();
    }
    return LanguageDetector.instance;
  }

  // ═══ INDICADORES CONHECIDOS ═══
  // Só o que TechnicalWords NÃO cobre — listas mínimas.
  // Grupos BR/EN e palavras técnicas já vêm do TechnicalWords.

  /** Palavras que SÓ aparecem em conteúdo PT-BR */
  private readonly INDICADORES_PT = new Set([
    'dublado', 'dublada', 'dublagem',
    'legendado', 'legendada',
    'nacional', 'dual',
  ]);

  /** Palavras que indicam conteúdo exclusivamente em inglês */
  private readonly INDICADORES_EN = new Set([
    'eng', 'english',
  ]);

  // ═══ CORE: Loop único palavra-por-palavra ═══

  /**
   * Itera CADA palavra do torrent e verifica TODOS os contextos:
   * - TMDB PT (título em português)
   * - TMDB EN (título original)
   * - Indicadores PT conhecidos + grupos BR (TechnicalWords)
   * - Indicadores EN conhecidos + grupos internacionais (TechnicalWords)
   * - Palavras técnicas (TechnicalWords) → ignoradas
   * - Números puros → ignorados
   * 
   * Retorna listas completas do que foi encontrado para debug.
   */
  verificarIdioma(
    tituloTorrent: string,
    tituloPt: string | null,
    tituloEn: string | null,
  ): {
    ehPortugues: boolean;
    motivo: string;
    palavrasPt: string[];
    palavrasEn: string[];
    desconhecidas: string[];
  } {
    // ═══ NORMALIZA ═══
    const normalizar = (texto: string): string[] => texto
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ').trim()
      .split(' ').filter(p => p.length > 0);

    const palavrasTorrent = normalizar(tituloTorrent);
    const setPt = new Set(tituloPt ? normalizar(tituloPt) : []);
    const setEn = new Set(tituloEn ? normalizar(tituloEn) : []);

    // ═══ LOOP ÚNICO ═══
    const encontradasPt: string[] = [];
    const encontradasEn: string[] = [];
    const desconhecidas: string[] = [];

    for (const palavra of palavrasTorrent) {
      // 1. Número puro → ignora (ano, bitrate)
      if (/^\d+$/.test(palavra)) continue;

      // 2. IDIOMA PRIMEIRO (antes de descartar como técnica!)
      //    "dublado", "dual", "legendado" etc estão no TechnicalWords
      //    mas são indicadores FORTES de PT-BR — devem ser priorizados.
      if (this.INDICADORES_PT.has(palavra) || isBrazilianReleaseGroup(palavra)) {
        encontradasPt.push(palavra);
        continue;
      }
      if (this.INDICADORES_EN.has(palavra) || isInternationalReleaseGroup(palavra)) {
        encontradasEn.push(palavra);
        continue;
      }

      // 3. TMDB PT/EN (título oficial)
      if (setPt.has(palavra)) {
        encontradasPt.push(palavra);
        continue;
      }
      if (setEn.has(palavra)) {
        encontradasEn.push(palavra);
        continue;
      }

      // 4. Palavra técnica → ignora (codec, resolução, formato)
      if (isTechnicalWord(palavra)) continue;

      // 5. Não bateu nenhum contexto → desconhecida
      desconhecidas.push(palavra);
    }

    // ═══ DECISÃO ═══
    if (encontradasPt.length > 0) {
      return {
        ehPortugues: true,
        motivo: encontradasEn.length > 0
          ? `PT detectado (${encontradasPt.join(', ')}) com EN (${encontradasEn.join(', ')})`
          : `PT detectado: ${encontradasPt.join(', ')}`,
        palavrasPt: encontradasPt,
        palavrasEn: encontradasEn,
        desconhecidas,
      };
    }

    if (encontradasEn.length > 0) {
      return {
        ehPortugues: false,
        motivo: `Apenas EN: ${encontradasEn.join(', ')}. Desconhecidas: ${desconhecidas.join(', ')}`,
        palavrasPt: [],
        palavrasEn: encontradasEn,
        desconhecidas,
      };
    }

    // Nada bateu → benefício da dúvida (pode ser nome próprio, título curto, etc.)
    return {
      ehPortugues: true,
      motivo: `Nenhum indicador claro. Desconhecidas: ${desconhecidas.join(', ')}`,
      palavrasPt: [],
      palavrasEn: [],
      desconhecidas,
    };
  }

  // ═══ MÉTODOS PÚBLICOS ═══

  /**
   * Verifica se o conteúdo é PT-BR usando TMDB (preciso).
   * Se TMDB não estiver disponível, fallback para heurística.
   */
  async verificarConteudoPortugues(
    tituloTorrent: string,
    imdbId?: string,
  ): Promise<boolean> {
    if (imdbId) {
      try {
        const tmdb = await this.imdbScraper.getTitlesFromImdbId(imdbId);
        if (tmdb && tmdb.allTitles.length > 0) {
          const resultado = this.verificarIdioma(
            tituloTorrent,
            tmdb.portugueseTitle,
            tmdb.originalTitle,
          );
          this.logger.debug('verificarConteudoPortugues (TMDB)', {
            titulo: tituloTorrent.substring(0, 60),
            ehPortugues: resultado.ehPortugues,
            motivo: resultado.motivo,
          });
          return resultado.ehPortugues;
        }
      } catch {
        // TMDB falhou, continua para fallback
      }
    }

    // Fallback: sem TMDB, verifica só indicadores explícitos (benefício da dúvida = PT)
    const resultado = this.verificarIdioma(tituloTorrent, null, null);
    return resultado.ehPortugues;
  }

  /**
   * Versão síncrona simples (sem TMDB).
   * Mantida para compatibilidade com callers que não podem ser async.
   */
  isPortugueseContent(tituloTorrent: string): boolean {
    // Modo rápido: sem TMDB, verifica APENAS indicadores explícitos (Dual, Dublado, grupos BR)
    // NÃO faz autocomparação (bug: título PT seria rejeitado como EN)
    const resultado = this.verificarIdioma(tituloTorrent, null, null);
    return resultado.ehPortugues;
  }

  // ═══ UTILITÁRIOS ═══

  /** Análise detalhada para debug */
  analisarTitulo(
    tituloTorrent: string,
    tituloPt?: string | null,
    tituloEn?: string,
  ) {
    return this.verificarIdioma(
      tituloTorrent,
      tituloPt || null,
      tituloEn || tituloTorrent,
    );
  }
}