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

    // Determina se é pack completo de temporada ou série completa
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

      // extrairAno retorna array, então pegamos o primeiro valor
      const anoDoTitulo = extrairAno(tituloTorrent)?.[0];
      const anoDoTituloParaIdioma = tituloParaIdioma ? extrairAno(tituloParaIdioma)?.[0] : undefined;
      const anoTorrent: number | undefined = anoDoScraper || anoDoTitulo || anoDoTituloParaIdioma;

      // Mexi aqui porque tituloParaIdioma é o título do post (usado só pra filtragem de scrapers)
      // Ele nunca deve influenciar validação de match. Só tituloTorrent (originalTitle do HTML) decide coleção.
      const isCollection = isCollectionTitle(tituloTorrent);

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
          //Aqui ele aceita pack de temporada quando o alvo cabe no range
          const isSeasonPack = range && range.seasonStart > 0 && range.episodeStart === 0 && range.episodeEnd === 0;
          if (isSeasonPack && temporadaAlvo !== undefined && temporadaAlvoNoRange(range, temporadaAlvo)) {
            // Pack de temporada: aceita como fallback
          }
        }
      }

      //Aqui ele checa se o alvo cabe no range de temporada declarado
      if (range && temporadaAlvo !== undefined && !temporadaAlvoNoRange(range, temporadaAlvo)) {
        return {
          matches: false,
          similarity: 0,
          torrentMetadata: metadados,
          reason: `Temporada diferente: S${range.seasonStart}-S${range.seasonEnd} vs S${temporadaAlvo}`
        };
      }

      // ✅ IMDb confirmado no HTML do post → pula similarity (economiza CPU/RAM)
      // Todas as validações acima (ano, range S/E, temporada) já rodaram. Só o fuzzy é pulado.
      // Seguro porque imdbConfirmed só vira true quando o link IMDb do post bate com o imdbId do request.
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

      // Mexi aqui pra rastrear que o years chega no Similarity, sem isso não dava pra saber se ia ou não
      this.logger.debug(`TITLEFILTER_REPASSA | torrent="${tituloTorrent.substring(0, 50)}" | year=${anoTorrent ?? '-'} | years=[${years?.join(',') ?? '-'}] | imdbAno=${imdbTitles?.year ?? '-'} | isYearInCollection=${isYearInCollection}`);

      const resultado = await this.similarityCalculator.smartTitleContainsCheck(
        tituloTorrent,
        imdbId,
        { year: anoTorrent, season: seasonParaSimilaridade, years },
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