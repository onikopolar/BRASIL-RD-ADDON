import { Logger } from '../utils/logger.js';
import { SimilarityCalculator } from './SimilarityCalculator.js';
import { LanguageDetector } from './LanguageDetector.js';
import { EpisodeMatcher } from './episodeMatcher.js';
import { extrairRangeEpisodios, extrairAno, isCollectionTitle } from './TechnicalWords.js';
import { TitleMatchResult, SeriesMetadata } from './interfaces.js';
import { ImdbTitles } from '../catalogo/ImdbScraperService.js';

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

  extrairMetadados(titulo: string): SeriesMetadata {
    const range = extrairRangeEpisodios(titulo);

    // Determina se é pack completo de temporada ou série completa
    const isCompleteSeason = range
      ? (range.season > 0 && range.episodeStart === 0 && range.episodeEnd === 0)
      : this.episodeMatcher.ehPackTemporadaCompleta(titulo);

    return {
      season: range?.season ?? undefined,
      episode: range?.episodeStart ?? undefined,
      isCompleteSeason,
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

  async titulosCombinam(
    tituloTorrent: string,
    imdbId: string,
    temporadaAlvo?: number,
    episodioAlvo?: number,
    tituloParaIdioma?: string,
    anoDoScraper?: number,
    imdbTitles?: ImdbTitles | null,
    htmlTitle?: string,
    episodioTorrent?: number,
    imdbConfirmed?: boolean,
    years?: number[],
  ): Promise<TitleMatchResult> {
    try {
      const metadados = this.extrairMetadados(tituloTorrent);

      // extrairAno retorna array, então pegamos o primeiro valor
      const anoDoTitulo = extrairAno(tituloTorrent)?.[0];
      const anoDoTituloParaIdioma = tituloParaIdioma ? extrairAno(tituloParaIdioma)?.[0] : undefined;
      const anoTorrent: number | undefined = anoDoScraper || anoDoTitulo || anoDoTituloParaIdioma;

      const isCollection = isCollectionTitle(tituloTorrent) || isCollectionTitle(tituloParaIdioma || '');

      let isYearInCollection = false;
      if (years && imdbTitles?.year !== undefined) {
        if (years.length > 1) {
          const minYear = Math.min(...years);
          const maxYear = Math.max(...years);
          isYearInCollection = imdbTitles.year >= minYear && imdbTitles.year <= maxYear;
        } else if (years.length === 1) {
          isYearInCollection = Math.abs(years[0] - imdbTitles.year) <= 1;
        }
      }

      this.logger.debug('TitleFilter: validação de ano', {
        tituloTorrent,
        anoTorrent,
        imdbAno: imdbTitles?.year,
        isCollection,
        years,
        isYearInCollection
      });

      if (
        !imdbConfirmed &&
        !isCollection &&
        !isYearInCollection &&
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

      if (isCollection && isYearInCollection) {
        this.logger.info('Coleção/franquia aceita por faixa de anos', {
          tituloTorrent,
          imdbAno: imdbTitles?.year,
          years
        });
        return {
          matches: true,
          similarity: 0.8,
          torrentMetadata: metadados,
          reason: 'Coleção/franquia com ano na faixa'
        };
      }

      const tituloParaRange = tituloTorrent || htmlTitle || tituloParaIdioma;
      let range = tituloParaRange ? extrairRangeEpisodios(tituloParaRange) : null;

      if (!range && htmlTitle) {
        range = extrairRangeEpisodios(htmlTitle);
      }
      if (!range && tituloParaIdioma) {
        range = extrairRangeEpisodios(tituloParaIdioma);
      }

      if (episodioAlvo !== undefined) {
        const temRange = range && range.episodeStart > 0 && range.episodeEnd > 0;

        if (temRange) {
          if (episodioAlvo < range!.episodeStart || episodioAlvo > range!.episodeEnd) {
            return {
              matches: false,
              similarity: 0,
              torrentMetadata: metadados,
              reason: `Episódio fora do range: E${episodioAlvo} vs E${range!.episodeStart}-E${range!.episodeEnd}`
            };
          }
        } else if (episodioTorrent !== undefined && episodioTorrent > 0) {
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
          }
        }
      }

      if (range && temporadaAlvo !== undefined && range.season > 0 && range.season !== temporadaAlvo) {
        return {
          matches: false,
          similarity: 0,
          torrentMetadata: metadados,
          reason: `Temporada diferente: S${range.season} vs S${temporadaAlvo}`
        };
      }

      const seasonParaSimilaridade = temporadaAlvo;
      const resultado = await this.similarityCalculator.smartTitleContainsCheck(
        tituloTorrent,
        imdbId,
        { year: anoTorrent, season: seasonParaSimilaridade },
        tituloParaIdioma,
        imdbTitles ?? undefined
      );

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
        tituloTorrent: tituloTorrent.substring(0, 60),
        imdbId,
        erro: erro instanceof Error ? erro.message : 'Erro'
      });
      return {
        matches: false,
        similarity: 0,
        torrentMetadata: this.extrairMetadados(tituloTorrent),
        reason: `Erro: ${erro instanceof Error ? erro.message : 'Erro'}`
      };
    }
  }
}

export { SeriesMetadata, TitleMatchResult };