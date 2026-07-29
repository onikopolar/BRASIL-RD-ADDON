import { Logger } from '../utils/logger.js';
import {
  isTechnicalWord,
  isInternationalReleaseGroup,
  isBrazilianReleaseGroup,
  INDICADORES_BRASIL_TORRENTS,
  INDICADORES_INTERNACIONAL_TORRENTS,
} from './TechnicalWords.js';

/**
 * LanguageDetector — Detecta se um titulo de torrent tem indicadores PT-BR.
 *
 * 100% delegado ao TechnicalWords:
 * - Palavras individuais → INDICADORES_BRASIL_TORRENTS / INDICADORES_INTERNACIONAL_TORRENTS
 * - Grupos → isBrazilianReleaseGroup / isInternationalReleaseGroup
 * - Palavras tecnicas (skip) → isTechnicalWord
 */
export class LanguageDetector {
  private readonly logger = new Logger('LanguageDetector');

  private static instance: LanguageDetector;

  public static getInstance(): LanguageDetector {
    if (!LanguageDetector.instance) {
      LanguageDetector.instance = new LanguageDetector();
    }
    return LanguageDetector.instance;
  }

  private readonly indicadoresPt: Set<string> = new Set(INDICADORES_BRASIL_TORRENTS);
  private readonly indicadoresEn: Set<string> = new Set(INDICADORES_INTERNACIONAL_TORRENTS);

  verificarIdioma(tituloTorrent: string): {
    ehPortugues: boolean;
    motivo: string;
    palavrasPt: string[];
    palavrasEn: string[];
    desconhecidas: string[];
  } {
    const palavras = tituloTorrent
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ').trim()
      .split(' ').filter(p => p.length > 0);

    const encontradasPt: string[] = [];
    const encontradasEn: string[] = [];
    const desconhecidas: string[] = [];

    for (const palavra of palavras) {
      if (/^\d+$/.test(palavra)) continue;

      // EN: palavra individual (TechnicalWords) OU grupo internacional (TechnicalWords)
      if (this.indicadoresEn.has(palavra) || isInternationalReleaseGroup(palavra)) {
        encontradasEn.push(palavra);
        continue;
      }

      // PT: palavra individual (TechnicalWords) OU grupo BR (TechnicalWords)
      if (this.indicadoresPt.has(palavra) || isBrazilianReleaseGroup(palavra)) {
        encontradasPt.push(palavra);
        continue;
      }

      if (isTechnicalWord(palavra)) continue;

      desconhecidas.push(palavra);
    }

    // DECISAO: EN sempre vence (se tem indicador internacional, nao eh PT)
    if (encontradasEn.length > 0) {
      return {
        ehPortugues: false,
        motivo: encontradasPt.length > 0
          ? `EN detectado (${encontradasEn.join(', ')}) — ignora PT (${encontradasPt.join(', ')})`
          : `EN detectado: ${encontradasEn.join(', ')}`,
        palavrasPt: encontradasPt,
        palavrasEn: encontradasEn,
        desconhecidas,
      };
    }

    if (encontradasPt.length > 0) {
      return {
        ehPortugues: true,
        motivo: `PT detectado: ${encontradasPt.join(', ')}`,
        palavrasPt: encontradasPt,
        palavrasEn: encontradasEn,
        desconhecidas,
      };
    }

    return {
      ehPortugues: false,
      motivo: `Nenhum indicador. Desconhecidas: ${desconhecidas.join(', ')}`,
      palavrasPt: [],
      palavrasEn: [],
      desconhecidas,
    };
  }

  isPortugueseContent(tituloTorrent: string): boolean {
    return this.verificarIdioma(tituloTorrent).ehPortugues;
  }
}