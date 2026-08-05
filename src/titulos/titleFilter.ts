import { Logger } from '../utils/logger.js';
import { SimilarityCalculator } from './SimilarityCalculator.js';
import { MetadataExtractor } from './MetadataExtractor.js';
import { LanguageDetector } from './LanguageDetector.js';
import { EpisodeMatcher } from './episodeMatcher.js';
import { extrairRangeEpisodios } from './TechnicalWords.js';
import { TitleMatchResult, SeriesMetadata } from './interfaces.js';

/**
 * TitleFilter — Orquestrador fino de validação de títulos.
 * 
 * SÓ valida similaridade de título (NÃO idioma).
 * Idioma é responsabilidade de quem chama (usar LanguageDetector direto).
 * Temporada/episódio é delegado ao EpisodeMatcher.
 */
export class TitleFilter {
  private readonly logger = new Logger('TitleFilter');
  private readonly similarityCalculator = SimilarityCalculator.getInstance();
  private readonly metadataExtractor = MetadataExtractor.getInstance();
  private readonly languageDetector = LanguageDetector.getInstance();
  private readonly episodeMatcher = EpisodeMatcher.getInstance();

  private static instance: TitleFilter;

  public static getInstance(): TitleFilter {
    if (!TitleFilter.instance) TitleFilter.instance = new TitleFilter();
    return TitleFilter.instance;
  }

  // ═══ MÉTODOS PÚBLICOS (delegações que outros módulos precisam) ═══

  /** Extrai metadados de série (temporada, episódio) do título */
  extrairMetadados(titulo: string): SeriesMetadata {
    return this.metadataExtractor.extractSeriesMetadata(titulo);
  }

  /** Verifica se o título tem indicadores de áudio PT-BR (rápido, sem TMDB) */
  conteudoEmPortugues(titulo: string): boolean {
    return this.languageDetector.isPortugueseContent(titulo);
  }

  /** Versão detalhada: retorna motivo, palavras encontradas PT/EN */
  verificarIdiomaDetalhado(titulo: string) {
    return this.languageDetector.verificarIdioma(titulo);
  }

  /** Extrai ano do título (ex: "Matrix 1999" → 1999) */
  extrairAno(titulo: string): number | undefined {
    const m = titulo.match(/\b(19|20)\d{2}\b/);
    return m ? parseInt(m[0]) : undefined;
  }

  // ═══ CORE: Validação de título (SÓ similaridade, NÃO idioma) ═══

  /**
   * Verifica se o título do torrent combina com o título TMDB do IMDB.
   * 
   * NÃO valida idioma — o chamador deve validar antes com LanguageDetector.
   * Valida temporada/episódio via EpisodeMatcher.
   * Valida similaridade via SimilarityCalculator.
   */
  async titulosCombinam(
    tituloTorrent: string,
    imdbId: string,
    temporadaAlvo?: number,
    episodioAlvo?: number,
    tituloParaIdioma?: string,
    anoDoScraper?: number
  ): Promise<TitleMatchResult> {
    try {
      // Metadados do originalTitle (similaridade de título)
      const metadados = this.extrairMetadados(tituloTorrent);
      // Prefere o ano extraído do HTML do post (scraper), fallback pra regex no título
      // Depois fallback pro canonicalName (dn magnet) — tem ano que o originalTitle não tem
      const anoTorrent: number | undefined = anoDoScraper || this.extrairAno(tituloTorrent) || (tituloParaIdioma ? this.extrairAno(tituloParaIdioma) : undefined);

      // Metadados do magnet dn (validação de temporada/episódio)
      // originalTitle ("House of the Dragon") não tem S/E — magnet dn tem
      const tituloParaEpisodio = tituloParaIdioma || tituloTorrent;
      const metadadosEpisodio = this.extrairMetadados(tituloParaEpisodio);

      // 1. Valida temporada/episódio usando extrairRangeEpisodios (TechnicalWords)
      let temporadaConfirmada = false;
      if (temporadaAlvo !== undefined) {
        // Tenta no magnet dn primeiro, fallback pro originalTitle
        let range = extrairRangeEpisodios(tituloParaEpisodio);
        if (!range && tituloTorrent !== tituloParaEpisodio) {
          range = extrairRangeEpisodios(tituloTorrent);
        }
        if (range) {
          if (range.season !== temporadaAlvo) {
            return {
              matches: false, similarity: 0, torrentMetadata: metadados,
              reason: `Temporada diferente: S${range.season} vs S${temporadaAlvo}`
            };
          }
          temporadaConfirmada = true; // season bateu → relaxa validação de ano
          if (episodioAlvo !== undefined && range.episodeStart > 0 && range.episodeEnd > 0) {
            if (episodioAlvo < range.episodeStart || episodioAlvo > range.episodeEnd) {
              return {
                matches: false, similarity: 0, torrentMetadata: metadados,
                reason: `Episódio fora do range: E${episodioAlvo} vs E${range.episodeStart}-E${range.episodeEnd}`
              };
            }
          }
        }
      }

      // 3. Valida similaridade de título (SimilarityCalculator puro)
      // Se temporada foi confirmada via extrairRangeEpisodios, relaxa ano
      // (scrapers podem extrair ano de upload em vez do ano da temporada)
      const anoParaSimilaridade = temporadaConfirmada ? undefined : anoTorrent;
      const resultado = await this.similarityCalculator.smartTitleContainsCheck(
        tituloTorrent, imdbId, { year: anoParaSimilaridade, season: temporadaAlvo }, tituloParaIdioma
      );

      // 4. Se TMDB diz que é FILME mas torrent tem indicadores de SÉRIE → rejeitar
      if (resultado.mediaType === 'movie' && this.episodeMatcher.temIndicadorTemporada(tituloTorrent)) {
        return {
          matches: false, similarity: 0, torrentMetadata: metadados,
          reason: 'Torrent é série, mas TMDB diz que é filme'
        };
      }

      return {
        matches: resultado.matches,
        similarity: resultado.similarity,
        torrentMetadata: metadados,
        reason: resultado.reason
      };
    } catch (erro) {
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

export { SeriesMetadata, TitleMatchResult };