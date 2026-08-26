import { Logger } from '../utils/logger.js';
import { SimilarityCalculator } from './SimilarityCalculator.js';
import { LanguageDetector } from './LanguageDetector.js';
import { EpisodeMatcher } from './episodeMatcher.js';
import { extrairRangeEpisodios } from './TechnicalWords.js';
import { TitleMatchResult, SeriesMetadata } from './interfaces.js';
import { ImdbTitles } from '../catalogo/ImdbScraperService.js';

/**
 * TitleFilter — Orquestrador fino de validação de títulos.
 * 
 * SÓ valida similaridade de título (NÃO idioma).
 * Idioma é responsabilidade de quem chama (usar LanguageDetector direto).
 * Temporada/episódio é delegado ao EpisodeMatcher ou validado diretamente via parâmetro.
 * 
 * IMPORTANTE: O parâmetro `tituloTorrent` deve ser o **título original extraído dos metadados do scraper**,
 * nunca o canonicalName ou magnet. Os scrapers devem fornecer `originalTitle` (ex.: "The Drama").
 */
export class TitleFilter {
  private readonly logger = new Logger('TitleFilter');
  private readonly similarityCalculator = SimilarityCalculator.getInstance();
  private readonly languageDetector = LanguageDetector.getInstance();
  private readonly episodeMatcher = EpisodeMatcher.getInstance();

  private static instance: TitleFilter;

  public static getInstance(): TitleFilter {
    if (!TitleFilter.instance) TitleFilter.instance = new TitleFilter();
    return TitleFilter.instance;
  }

  // ═══ MÉTODOS PÚBLICOS (delegações) ═══

  extrairMetadados(titulo: string): SeriesMetadata {
    const range = extrairRangeEpisodios(titulo);
    return {
      season: range?.season ?? undefined,
      episode: range?.episodeStart ?? undefined,
      isCompleteSeason: range ? (range.season > 0 && range.episodeStart === 0 && range.episodeEnd === 0) : false,
      hasEpisodeInfo: !!(range && (range.season > 0 || range.episodeStart > 0)),
      matchedPattern: undefined,
    };
  }

  conteudoEmPortugues(titulo: string): boolean {
    return this.languageDetector.isPortugueseContent(titulo);
  }

  verificarIdiomaDetalhado(titulo: string) {
    return this.languageDetector.verificarIdioma(titulo);
  }

  extrairAno(titulo: string): number | undefined {
    const m = titulo.match(/\b(19|20)\d{2}\b/);
    return m ? parseInt(m[0]) : undefined;
  }

  // ═══ CORE: Validação de título ═══

  /**
   * Verifica se o título do torrent combina com o título TMDB do IMDB.
   * 
   * @param tituloTorrent   título principal do torrent (originalTitle dos metadados)
   * @param imdbId          identificador IMDb
   * @param temporadaAlvo   temporada alvo (opcional)
   * @param episodioAlvo    episódio alvo (opcional)
   * @param tituloParaIdioma título alternativo para checagem de idioma
   * @param anoDoScraper    ano extraído do scraper (opcional)
   * @param imdbTitles      dados TMDB pré‑carregados (evita nova chamada à API)
   * @param htmlTitle       título bruto do HTML (opcional, para extração de S/E)
   * @param episodioTorrent episódio extraído do torrent (opcional, validação direta)
   */
  async titulosCombinam(
    tituloTorrent: string,
    imdbId: string,
    temporadaAlvo?: number,
    episodioAlvo?: number,
    tituloParaIdioma?: string,
    anoDoScraper?: number,
    imdbTitles?: ImdbTitles | null,
    htmlTitle?: string,
    episodioTorrent?: number
  ): Promise<TitleMatchResult> {
    try {
      const metadados = this.extrairMetadados(tituloTorrent);
      const anoTorrent: number | undefined = anoDoScraper || this.extrairAno(tituloTorrent) || (tituloParaIdioma ? this.extrairAno(tituloParaIdioma) : undefined);

      // ── 1.5 VALIDAÇÃO DE ANO (tolerância de ±1 ano para lançamentos regionais) ──
      if (
        anoTorrent !== undefined &&
        imdbTitles?.year !== undefined &&
        Math.abs(anoTorrent - imdbTitles.year) > 1
      ) {
        return {
          matches: false,
          similarity: 0,
          torrentMetadata: metadados,
          reason: `Ano divergente: ${anoTorrent} vs ${imdbTitles.year}`
        };
      }

      // ── 1. EXTRAI RANGE DE EPISÓDIOS (prioridade: título principal > htmlTitle > título alternativo) ──
      const tituloParaRange = tituloTorrent || htmlTitle || tituloParaIdioma;
      let range = tituloParaRange ? extrairRangeEpisodios(tituloParaRange) : null;

      if (!range && htmlTitle) {
        range = extrairRangeEpisodios(htmlTitle);
      }
      if (!range && tituloParaIdioma) {
        range = extrairRangeEpisodios(tituloParaIdioma);
      }

      // ── 2. VALIDAÇÃO DE EPISÓDIO (com prioridade para episódio exato) ──
      if (episodioAlvo !== undefined) {
        const episodioExato = episodioTorrent !== undefined && episodioTorrent > 0;

        if (episodioExato) {
          if (episodioTorrent !== episodioAlvo) {
            return {
              matches: false,
              similarity: 0,
              torrentMetadata: metadados,
              reason: `Episódio diferente: E${episodioTorrent} vs alvo E${episodioAlvo}`
            };
          }
        } else {
          const isSeasonPack = range && range.season > 0 && range.episodeStart === 0 && range.episodeEnd === 0;
          if (isSeasonPack && temporadaAlvo !== undefined && range!.season === temporadaAlvo) {
            // Pack de temporada: aceita como fallback
          } else if (range && range.episodeStart > 0 && range.episodeEnd > 0) {
            if (episodioAlvo < range.episodeStart || episodioAlvo > range.episodeEnd) {
              return {
                matches: false,
                similarity: 0,
                torrentMetadata: metadados,
                reason: `Episódio fora do range: E${episodioAlvo} vs E${range.episodeStart}-E${range.episodeEnd}`
              };
            }
          }
        }
      }

      // ── 3. VALIDAÇÃO DE TEMPORADA ──
      if (range && temporadaAlvo !== undefined && range.season > 0 && range.season !== temporadaAlvo) {
        return {
          matches: false,
          similarity: 0,
          torrentMetadata: metadados,
          reason: `Temporada diferente: S${range.season} vs S${temporadaAlvo}`
        };
      }

      // ── 4. SIMILARIDADE ──
      const seasonParaSimilaridade = temporadaAlvo;
      const resultado = await this.similarityCalculator.smartTitleContainsCheck(
        tituloTorrent,
        imdbId,
        { year: anoTorrent, season: seasonParaSimilaridade },
        tituloParaIdioma,
        imdbTitles ?? undefined
      );

      // ── 5. FILTRO FINAL ──
      if (resultado.mediaType === 'movie' && this.episodeMatcher.temIndicadorTemporada(tituloTorrent)) {
        return {
          matches: false,
          similarity: 0,
          torrentMetadata: metadados,
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