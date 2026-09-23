import { Logger } from '../utils/logger.js';
import { SimilarityCalculator } from './SimilarityCalculator.js';
import { LanguageDetector } from './LanguageDetector.js';
import { EpisodeMatcher } from './episodeMatcher.js';
import { extrairRangeEpisodios, extrairAno, isCollectionTitle, temporadaAlvoNoRange } from './TechnicalWords.js';
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

    const isCompleteSeason = range
      ? (range.seasonStart > 0 && range.episodeStart === 0 && range.episodeEnd === 0)
      : this.episodeMatcher.ehPackTemporadaCompleta(titulo);

    return {
      season: range?.seasonStart ?? undefined,
      episode: range?.episodeStart ?? undefined,
      isCompleteSeason,
      hasEpisodeInfo: !!(range && (range.seasonStart > 0 || range.episodeStart > 0)),
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

      const anoDoTitulo = extrairAno(tituloTorrent)?.[0];
      const anoDoTituloParaIdioma = tituloParaIdioma ? extrairAno(tituloParaIdioma)?.[0] : undefined;
      const anoTorrent: number | undefined = anoDoScraper || anoDoTitulo || anoDoTituloParaIdioma;

      const isCollection = isCollectionTitle(tituloTorrent);

      // Se o parâmetro years não veio, extrai do próprio título do torrent — packs costumam declarar "(2001-2011)".
      const yearsDoTitulo = extrairAno(tituloTorrent);
      const yearsEfetivos = (years && years.length > 0) ? years : yearsDoTitulo;

      let isYearInCollection = false;
      if (yearsEfetivos && imdbTitles?.year !== undefined) {
        if (yearsEfetivos.length > 1) {
          const minYear = Math.min(...yearsEfetivos);
          const maxYear = Math.max(...yearsEfetivos);
          isYearInCollection = imdbTitles.year >= minYear && imdbTitles.year <= maxYear;
        } else if (yearsEfetivos.length === 1) {
          isYearInCollection = Math.abs(yearsEfetivos[0] - imdbTitles.year) <= 1;
        }
      }

      this.logger.debug('TitleFilter: validação de ano', {
        tituloTorrent,
        anoTorrent,
        imdbAno: imdbTitles?.year,
        isCollection,
        years: yearsEfetivos,
        isYearInCollection,
        imdbConfirmed: imdbConfirmed ?? false,
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

      if (
        imdbConfirmed &&
        !isCollection &&
        anoTorrent !== undefined &&
        imdbTitles?.year !== undefined &&
        Math.abs(anoTorrent - imdbTitles.year) > 1
      ) {
        this.logger.debug(
          `SKIP_ANO_POR_IMDB_CONFIRMADO | "${tituloTorrent.substring(0, 50)}" | ano=${anoTorrent} imdbAno=${imdbTitles.year} diff=${Math.abs(anoTorrent - imdbTitles.year)}`
        );
      }

      if (isCollection && isYearInCollection) {
        this.logger.info('Coleção/franquia aceita por faixa de anos', {
          tituloTorrent,
          imdbAno: imdbTitles?.year,
          years: yearsEfetivos
        });
        return {
          matches: true,
          similarity: 0.8,
          torrentMetadata: metadados,
          reason: 'Coleção/franquia com ano na faixa'
        };
      }

      // Coleção com range de anos declarado que NÃO contém o alvo → rejeita direto.
      // Não cai pro similarity: o próprio título já disse que o filme não está no pack.
      if (
        isCollection &&
        yearsEfetivos &&
        yearsEfetivos.length > 1 &&
        imdbTitles?.year !== undefined &&
        !isYearInCollection
      ) {
        return {
          matches: false,
          similarity: 0,
          torrentMetadata: metadados,
          reason: `Coleção ${yearsEfetivos.join('-')} não contém ${imdbTitles.year}`
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
          const isSeasonPack = range && range.seasonStart > 0 && range.episodeStart === 0 && range.episodeEnd === 0;
          if (isSeasonPack && temporadaAlvo !== undefined && temporadaAlvoNoRange(range, temporadaAlvo)) {
            // Pack de temporada: aceita como fallback
          }
        }
      }

      if (range && temporadaAlvo !== undefined && !temporadaAlvoNoRange(range, temporadaAlvo)) {
        return {
          matches: false,
          similarity: 0,
          torrentMetadata: metadados,
          reason: `Temporada diferente: S${range.seasonStart}-S${range.seasonEnd} vs S${temporadaAlvo}`
        };
      }

      if (imdbConfirmed && !isCollection) {
        this.logger.debug(
          `IMDB_CONFIRMADO_SKIP_SIMILARITY | torrent="${tituloTorrent.substring(0, 50)}" | imdbId=${imdbId}`
        );
        return {
          matches: true,
          similarity: 0.9,
          torrentMetadata: metadados,
          reason: 'IMDb confirmado no post'
        };
      }

      const seasonParaSimilaridade = temporadaAlvo;

      this.logger.debug(`TITLEFILTER_REPASSA | torrent="${tituloTorrent.substring(0, 50)}" | year=${anoTorrent ?? '-'} | years=[${yearsEfetivos?.join(',') ?? '-'}] | imdbAno=${imdbTitles?.year ?? '-'} | isYearInCollection=${isYearInCollection}`);

      const resultado = await this.similarityCalculator.smartTitleContainsCheck(
        tituloTorrent,
        imdbId,
        { year: anoTorrent, season: seasonParaSimilaridade, years: yearsEfetivos },
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