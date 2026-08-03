import { Logger } from '../utils/logger.js';
import { SimilarityCalculator } from './SimilarityCalculator.js';
import { MetadataExtractor } from './MetadataExtractor.js';
import { LanguageDetector } from './LanguageDetector.js';
import { EpisodeMatcher } from './episodeMatcher.js';
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
      const anoTorrent = anoDoScraper || this.extrairAno(tituloTorrent);

      // Metadados do magnet dn (validação de temporada/episódio)
      // originalTitle ("House of the Dragon") não tem S/E — magnet dn tem
      const tituloParaEpisodio = tituloParaIdioma || tituloTorrent;
      const metadadosEpisodio = this.extrairMetadados(tituloParaEpisodio);

      // 1. Valida temporada (se aplicável)
      if (temporadaAlvo !== undefined) {
        if (metadadosEpisodio.season && metadadosEpisodio.season !== temporadaAlvo) {
          return {
            matches: false, similarity: 0, torrentMetadata: metadados,
            reason: `Temporada diferente: S${metadadosEpisodio.season} vs S${temporadaAlvo}`
          };
        }

        // 2. Valida episódio (se aplicável)
        if (episodioAlvo !== undefined) {
          // Se tem temporada detectada mas não tem episódio → provável pack de temporada
          if (metadadosEpisodio.season && metadadosEpisodio.episode === undefined && !metadadosEpisodio.isCompleteSeason) {
            // Deixa passar — SimilarityCalculator decide se é compatível
          } else {
            const compat = this.episodeMatcher.episodioEhCompativel(
              tituloParaEpisodio, metadadosEpisodio.episode, episodioAlvo, temporadaAlvo
            );
            if (!compat.compativel) {
              return { matches: false, similarity: 0, torrentMetadata: metadados, reason: compat.motivo };
            }
          }
        }
      }

      // 3. Valida similaridade de título (SimilarityCalculator puro)
      const resultado = await this.similarityCalculator.smartTitleContainsCheck(
        tituloTorrent, imdbId, { year: anoTorrent, season: temporadaAlvo }, tituloParaIdioma
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