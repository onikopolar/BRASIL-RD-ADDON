"use strict";

// Módulos externos necessários (supondo que existam os arquivos)
const Logger = require("../../utils/logger.js").Logger;
const ImdbScraperService = require("../../services/ImdbScraperService.js").ImdbScraperService;
const TECHNICAL_WORDS = require("./TechnicalWords.js").TECHNICAL_WORDS;
const TECHNICAL_ACRONYMS = require("./TechnicalWords.js").TECHNICAL_ACRONYMS;

// Classe principal
class SimilarityCalculator {
  // Método singleton
  static getInstance() {
    if (!SimilarityCalculator.instance) {
      SimilarityCalculator.instance = new SimilarityCalculator(undefined, true);
    }
    return SimilarityCalculator.instance;
  }

  // Construtor
  constructor(_titleCleaner, useTmdbScraper) {
    // Parâmetro opcional com valor padrão true
    if (useTmdbScraper === undefined) {
      useTmdbScraper = true;
    }

    this.tmdbCache = new Map();
    this.cacheTTL = 5 * 60 * 1000; // 5 minutos
    this.VERSAO = "23.6.1";
    this.logger = new Logger("SimilarityCalculator");

    if (useTmdbScraper) {
      this.tmdbScraper = ImdbScraperService.getInstance();
    } else {
      this.tmdbScraper = null;
    }

    this.confusingSeries = [
      { original: "american horror story", derivative: "american horror stories", minSimilarity: 0.85 },
      { original: "stranger things", derivative: "stranger things stories", minSimilarity: 0.85 }
    ];
  }

  // Método assíncrono principal de verificação
  async smartTitleContainsCheck(torrentTitle, imdbId, torrentMetadata) {
    let movieInfo = null;

    // Se houver um scraper TMDB, buscar informações
    if (this.tmdbScraper) {
      try {
        let season = null;
        if (torrentMetadata && torrentMetadata.season) {
          season = torrentMetadata.season;
        }

        let cacheKey;
        if (season) {
          cacheKey = "tmdb-" + imdbId + ":s" + season;
        } else {
          cacheKey = "tmdb-" + imdbId;
        }

        let tmdbData;
        let cached = this.tmdbCache.get(cacheKey);

        if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
          tmdbData = cached.data;
        } else {
          // Aguarda a promessa do scraper (uso de await)
          tmdbData = await this.tmdbScraper.getTitlesFromImdbId(imdbId, season);
          this.tmdbCache.set(cacheKey, { data: tmdbData, timestamp: Date.now() });
        }

        movieInfo = {
          portugueseTitle: tmdbData.portugueseTitle,
          originalTitle: tmdbData.originalTitle,
          year: tmdbData.year,
          allTitles: tmdbData.allTitles,
          mediaType: tmdbData.mediaType,
          belongsToCollection: tmdbData.belongsToCollection
        };
      } catch (error) {
        let errorMessage = "Erro desconhecido";
        if (error instanceof Error) {
          errorMessage = error.message;
        }
        this.logger.error("Erro ao buscar TMDB", { imdbId: imdbId, error: errorMessage });
      }
    }

    // Se não conseguiu obter movieInfo, retorna falha
    if (!movieInfo) {
      return { matches: false, similarity: 0, reason: "Sem dados do TMDB" };
    }

    // Extrai ano do torrent
    let torrentYear = null;
    if (torrentMetadata && torrentMetadata.year) {
      torrentYear = torrentMetadata.year;
    }
    if (!torrentYear) {
      torrentYear = this.extractYearFromTitle(torrentTitle);
    }

    // Normaliza o título do torrent
    let torrentClean = this.normalizeForComparison(torrentTitle, movieInfo.mediaType);

    // Realiza a análise de contexto
    let matchResult = this.enhancedContextAnalysis(
      torrentClean,
      torrentTitle,
      movieInfo.portugueseTitle,
      movieInfo.originalTitle,
      movieInfo.allTitles,
      movieInfo.year,
      torrentYear,
      movieInfo.mediaType,
      movieInfo.belongsToCollection,
      (torrentMetadata && torrentMetadata.season) ? torrentMetadata.season : undefined
    );

    // Validação extra pelo ano
    if (matchResult.matches) {
      let yearValidation = this.contextualYearValidation(
        movieInfo,
        torrentYear,
        torrentTitle,
        matchResult.similarity,
        matchResult.confidence,
        (torrentMetadata && torrentMetadata.season) ? torrentMetadata.season : undefined
      );

      if (yearValidation.shouldReject) {
        return {
          matches: false,
          similarity: matchResult.similarity * 0.7,
          reason: yearValidation.reason
        };
      }
      return matchResult;
    }

    return matchResult;
  }

  // Validação de ano baseada em contexto
  contextualYearValidation(movieInfo, torrentYear, torrentTitle, semanticSimilarity, confidence, targetSeason) {
    if (!movieInfo.year) {
      return { shouldReject: false, reason: "TMDB sem ano" };
    }

    // Se o torrent não tem ano
    if (!torrentYear) {
      // Série com temporada explícita ganha bônus
      if (movieInfo.mediaType === "tv" && targetSeason && this.hasExplicitSeason(torrentTitle, targetSeason)) {
        let bonus = 0.1;
        if (this.hasExplicitEpisode(torrentTitle)) {
          bonus = 0.15;
        }
        if (semanticSimilarity + bonus >= 0.65) {
          return { shouldReject: false, reason: "Série com temporada explícita (S" + targetSeason + ")" };
        }
      }
      if (semanticSimilarity >= 0.9 || confidence === "alta") {
        return { shouldReject: false, reason: "Similaridade/confiança altas" };
      }
      return { shouldReject: true, reason: "Requer ano. TMDB: " + movieInfo.year };
    }

    // Se o ano é diferente
    if (movieInfo.year !== torrentYear) {
      let yearDiff = Math.abs(movieInfo.year - torrentYear);
      if (yearDiff <= 2 && semanticSimilarity >= 0.85) {
        return { shouldReject: false, reason: "Diferença pequena (" + yearDiff + " anos) com contexto forte" };
      }
      return {
        shouldReject: true,
        reason: "Ano diferente: TMDB " + movieInfo.year + " != Torrent " + torrentYear
      };
    }

    return { shouldReject: false, reason: "Ano válido" };
  }

  // Análise avançada comparando todos os títulos válidos do TMDB
  enhancedContextAnalysis(
    torrentClean,
    originalTorrentTitle,
    portugueseTitle,
    originalTitle,
    allTmdbTitles,
    tmdbYear,
    torrentYear,
    mediaType,
    belongsToCollection,
    targetSeason
  ) {
    let validTmdbTitles = this.filterValidTmdbTitles(allTmdbTitles, originalTitle);

    if (validTmdbTitles.length === 0) {
      return { matches: false, similarity: 0, reason: "Nenhum título TMDB válido" };
    }

    let bestMatch = {
      similarity: 0,
      confidence: "baixa",
      title: "",
      reason: "",
      matchedTmdbTitle: "",
      contextAnalysis: ""
    };

    // Itera sobre cada título válido e guarda o melhor
    for (let i = 0; i < validTmdbTitles.length; i++) {
      let tmdbTitle = validTmdbTitles[i];
      let tmdbClean = this.normalizeForComparison(tmdbTitle, mediaType);
      let contextResult = this.smartContextAnalysis(
        torrentClean,
        tmdbClean,
        mediaType,
        belongsToCollection,
        targetSeason,
        originalTorrentTitle
      );

      if (contextResult.similarity > bestMatch.similarity) {
        bestMatch = {
          similarity: contextResult.similarity,
          confidence: contextResult.confidence,
          title: tmdbTitle,
          reason: contextResult.reason,
          matchedTmdbTitle: tmdbTitle,
          contextAnalysis: contextResult.contextAnalysis
        };
      }
    }

    // Define limiares
    let threshold = mediaType === "movie" ? 0.75 : 0.65;
    let tmdbTitleLength = 0;
    if (validTmdbTitles.length > 0 && validTmdbTitles[0]) {
      tmdbTitleLength = validTmdbTitles[0].length;
    }
    let effectiveThreshold = threshold;
    if (tmdbTitleLength <= 3) {
      effectiveThreshold = threshold * 0.7;
    }

    if (bestMatch.similarity >= effectiveThreshold) {
      return {
        matches: true,
        similarity: bestMatch.similarity,
        reason: bestMatch.reason,
        matchedTmdbTitle: bestMatch.matchedTmdbTitle,
        confidence: bestMatch.confidence,
        contextAnalysis: bestMatch.contextAnalysis
      };
    }

    return {
      matches: false,
      similarity: bestMatch.similarity,
      reason: bestMatch.reason || "Similaridade insuficiente"
    };
  }

  // Filtra títulos TMDB inválidos
  filterValidTmdbTitles(allTitles, originalTitle) {
    let valid = [];
    for (let i = 0; i < allTitles.length; i++) {
      let t = allTitles[i];
      if (t && t.trim().length > 0) {
        let lower = t.toLowerCase().trim();
        let blacklist = ["n/a", "não encontrado", "not found", "unknown"];
        if (!blacklist.includes(lower)) {
          valid.push(t);
        }
      }
    }
    if (valid.length > 0) {
      return valid;
    }
    return [originalTitle];
  }

  // Análise de contexto inteligente, divide entre títulos curtos e longos
  smartContextAnalysis(torrentClean, tmdbClean, mediaType, belongsToCollection, targetSeason, originalTorrentTitle) {
    let tmdbWords = tmdbClean.split(" ").filter(function (w) {
      return w.length > 0;
    });
    let torrentWords = torrentClean.split(" ").filter(function (w) {
      return w.length > 0;
    });

    // Verificação de sequências em filmes
    if (mediaType === "movie") {
      let seqCheck = this.checkSequenceCompatibility(torrentClean, tmdbClean, belongsToCollection, originalTorrentTitle);
      if (!seqCheck.compatible) {
        return {
          similarity: seqCheck.similarity,
          confidence: "baixa",
          reason: seqCheck.reason,
          contextAnalysis: "sequência_incompatível"
        };
      }
    }

    // Títulos de uma única palavra
    if (tmdbWords.length === 1) {
      return this.analyzeSingleWordTitle(
        tmdbClean,
        torrentClean,
        mediaType,
        targetSeason,
        originalTorrentTitle
      );
    }

    // Títulos de duas palavras
    if (tmdbWords.length === 2) {
      return this.analyzeDoubleWordTitle(
        tmdbClean,
        torrentClean,
        mediaType,
        belongsToCollection,
        targetSeason,
        originalTorrentTitle
      );
    }

    // Títulos maiores
    return this.normalContextAnalysis(
      torrentClean,
      tmdbClean,
      mediaType,
      targetSeason,
      originalTorrentTitle
    );
  }

  // Verifica compatibilidade de números de sequência (ex: Rocky 2 vs Rocky 3)
  checkSequenceCompatibility(torrentClean, tmdbClean, belongsToCollection, originalTorrentTitle) {
    let torrentSeq = this.extractSequenceNumber(torrentClean);
    let tmdbSeq = this.extractSequenceNumber(tmdbClean);

    // Torrent sem número, TMDB com número
    if (!torrentSeq && tmdbSeq) {
      let originalLower = (originalTorrentTitle || torrentClean).toLowerCase();
      if (originalLower.includes(tmdbSeq) || originalLower.includes(" " + tmdbSeq)) {
        return { compatible: true, similarity: 0.75, reason: "Número " + tmdbSeq + " encontrado no título original" };
      }
      if (belongsToCollection && (tmdbSeq === "1" || tmdbSeq === "i")) {
        return { compatible: true, similarity: 0.8, reason: "TMDB é primeira sequência em coleção" };
      }
      return { compatible: false, similarity: 0.15, reason: "TMDB tem sequência " + tmdbSeq + " mas torrent não" };
    }

    // Torrent com número, TMDB sem número
    if (torrentSeq && !tmdbSeq) {
      if (belongsToCollection && (torrentSeq === "1" || torrentSeq === "i")) {
        return { compatible: true, similarity: 0.8, reason: "Primeira sequência em coleção" };
      }
      return { compatible: false, similarity: 0.1, reason: "Torrent tem sequência " + torrentSeq + " mas TMDB não" };
    }

    // Ambos têm número: devem ser iguais
    if (torrentSeq && tmdbSeq) {
      if (torrentSeq === tmdbSeq) {
        return { compatible: true, similarity: 1, reason: "Números iguais: " + torrentSeq };
      }
      return { compatible: false, similarity: 0.1, reason: "Números diferentes: Torrent " + torrentSeq + " vs TMDB " + tmdbSeq };
    }

    // Nenhum tem número
    return { compatible: true, similarity: 1, reason: "Nenhum número de sequência" };
  }

  // Extrai número de sequência (algarismos romanos ou padrões)
  extractSequenceNumber(title) {
    let words = title.split(" ").filter(function (w) {
      return w.length > 0;
    });
    if (words.length === 0) {
      return null;
    }

    function isValidSeq(n) {
      return n >= 1 && n <= 20;
    }

    // Padrão seqX
    let seqMatch = title.match(/seq(\d+)/i);
    if (seqMatch && isValidSeq(parseInt(seqMatch[1], 10))) {
      return seqMatch[1];
    }

    // Última palavra como número
    let lastWord = words[words.length - 1].toLowerCase();
    if (/^\d+$/.test(lastWord) && isValidSeq(parseInt(lastWord, 10))) {
      return lastWord;
    }
    if (SimilarityCalculator.ROMAN_MAP[lastWord]) {
      return SimilarityCalculator.ROMAN_MAP[lastWord];
    }

    // Procura em qualquer palavra
    for (let i = 0; i < words.length; i++) {
      let w = words[i];
      let lower = w.toLowerCase();
      if (SimilarityCalculator.ROMAN_MAP[lower]) {
        return SimilarityCalculator.ROMAN_MAP[lower];
      }
      if (/^\d+$/.test(w) && isValidSeq(parseInt(w, 10))) {
        return w;
      }
    }

    // Padrões adicionais
    let patterns = SimilarityCalculator.SEQ_PATTERNS;
    for (let i = 0; i < patterns.length; i++) {
      let match = title.match(patterns[i]);
      if (match && match[1] && isValidSeq(parseInt(match[1], 10))) {
        return match[1];
      }
    }
    return null;
  }

  // Análise de título com uma única palavra
  analyzeSingleWordTitle(tmdbWord, torrentClean, mediaType, targetSeason, originalTorrentTitle) {
    let torrentWords = torrentClean.split(" ").filter(function (w) {
      return w.length > 0;
    });

    // Verifica se a palavra do TMDB existe no torrent
    let containsWord = false;
    for (let i = 0; i < torrentWords.length; i++) {
      if (torrentWords[i] === tmdbWord) {
        containsWord = true;
        break;
      }
    }
    if (!containsWord) {
      return {
        similarity: 0,
        confidence: "baixa",
        reason: 'Palavra "' + tmdbWord + '" não encontrada',
        contextAnalysis: "título_curto_não_contém"
      };
    }

    // Bônus para séries com temporada explícita
    if (mediaType === "tv" && targetSeason !== undefined && originalTorrentTitle) {
      let hasSeason = this.hasExplicitSeason(originalTorrentTitle, targetSeason);
      let hasEpisode = this.hasExplicitEpisode(originalTorrentTitle);
      if (hasSeason && hasEpisode) {
        return {
          similarity: 0.7,
          confidence: "média",
          reason: "Série com temporada e episódio explícitos (S" + targetSeason + ")",
          contextAnalysis: "série_com_sxxexx"
        };
      }
      if (hasSeason) {
        return {
          similarity: 0.65,
          confidence: "média",
          reason: "Série com temporada explícita (S" + targetSeason + ")",
          contextAnalysis: "série_com_temporada"
        };
      }
    }

    // Análise de densidade
    let densityAnalysis = this.analyzeSemanticDensity([tmdbWord], torrentWords);
    if (densityAnalysis.isExcessive) {
      return {
        similarity: 0.1,
        confidence: "baixa",
        reason: "Densidade excessiva: " + torrentWords.length + " vs 1 palavras",
        contextAnalysis: "densidade_excessiva_imediata"
      };
    }

    // Contexto global
    let contextAnalysisGlobal = this.analyzeGlobalContext(tmdbWord, torrentWords);
    if (!contextAnalysisGlobal.hasStrongContext) {
      return {
        similarity: 0.2,
        confidence: "baixa",
        reason: "Contexto fraco: " + contextAnalysisGlobal.reason,
        contextAnalysis: "contexto_fraco_imediato"
      };
    }

    // Posição da palavra e penalidades por palavras extras
    let wordPosition = -1;
    for (let i = 0; i < torrentWords.length; i++) {
      if (torrentWords[i] === tmdbWord) {
        wordPosition = i;
        break;
      }
    }
    let isFirstWord = wordPosition === 0;
    let extraWords = torrentWords.length - 1;

    let penalty;
    if (extraWords === 0) {
      penalty = 1.0;
    } else if (extraWords === 1) {
      penalty = 0.7;
    } else if (extraWords === 2) {
      penalty = 0.5;
    } else if (extraWords === 3) {
      penalty = 0.3;
    } else {
      penalty = Math.max(0.1, 1.0 - extraWords * 0.2);
    }

    if (!isFirstWord) {
      penalty *= Math.max(0.1, 1.0 - wordPosition * 0.4);
    }

    let finalSimilarity = 1.0 * penalty;

    // Bônus se começa com a palavra e poucas palavras extras
    if (torrentClean.startsWith(tmdbWord + " ") && isFirstWord && extraWords <= 1) {
      finalSimilarity = Math.min(0.9, finalSimilarity * 1.1);
    }
    // Palavra muito curta sem extras
    if (tmdbWord.length <= 3 && extraWords === 0) {
      finalSimilarity = Math.min(1.0, finalSimilarity * 1.05);
    }

    let confidence;
    if (finalSimilarity >= 0.85) {
      confidence = "alta";
    } else if (finalSimilarity >= 0.7) {
      confidence = "média";
    } else {
      confidence = "baixa";
    }

    let reason;
    if (confidence === "alta") {
      reason = "Match forte: " + (finalSimilarity * 100).toFixed(1) + "%";
    } else if (confidence === "média") {
      reason = "Match moderado: " + (finalSimilarity * 100).toFixed(1) + "%";
    } else {
      reason = "Similaridade baixa: " + (finalSimilarity * 100).toFixed(1) + "%";
    }
    reason += ' (palavra única "' + tmdbWord + '" com ' + extraWords + " palavras extras)";

    return {
      similarity: finalSimilarity,
      confidence: confidence,
      reason: reason,
      contextAnalysis: "título_curto_1_palavra:penalidade_" + penalty.toFixed(2)
    };
  }

  // Análise de título com duas palavras
  analyzeDoubleWordTitle(tmdbClean, torrentClean, mediaType, belongsToCollection, targetSeason, originalTorrentTitle) {
    let tmdbWords = tmdbClean.split(" ").filter(function (w) {
      return w.length > 0;
    });
    let torrentWords = torrentClean.split(" ").filter(function (w) {
      return w.length > 0;
    });

    // Verifica se todas as palavras do TMDB estão no torrent
    let allPresent = true;
    let missing = [];
    for (let i = 0; i < tmdbWords.length; i++) {
      let w = tmdbWords[i];
      let found = false;
      for (let j = 0; j < torrentWords.length; j++) {
        if (torrentWords[j] === w) {
          found = true;
          break;
        }
      }
      if (!found) {
        allPresent = false;
        missing.push(w);
      }
    }

    if (!allPresent) {
      return {
        similarity: 0.1,
        confidence: "baixa",
        reason: "Palavras faltando: " + missing.join(", "),
        contextAnalysis: "título_duas_palavras_faltando"
      };
    }

    // Bônus para séries
    if (mediaType === "tv" && targetSeason !== undefined && originalTorrentTitle) {
      if (this.hasExplicitSeason(originalTorrentTitle, targetSeason)) {
        let bonus = this.hasExplicitEpisode(originalTorrentTitle) ? 0.15 : 0.1;
        let densityAnalysis = this.analyzeSemanticDensity(tmdbWords, torrentWords);
        if (densityAnalysis.isExcessive) {
          return {
            similarity: 0.6 + bonus,
            confidence: "média",
            reason: "Série com temporada explícita (densidade alta ajustada)",
            contextAnalysis: "série_com_temporada_densidade"
          };
        }
      }
    }

    // Densidade
    let densityAnalysis = this.analyzeSemanticDensity(tmdbWords, torrentWords);
    if (densityAnalysis.isExcessive) {
      return {
        similarity: 0.15,
        confidence: "baixa",
        reason: "Densidade excessiva: " + torrentWords.length + " vs " + tmdbWords.length + " palavras",
        contextAnalysis: "densidade_excessiva_imediata"
      };
    }

    // Similaridade básica
    let basicSimilarity = this.calculateWordSimilarity(tmdbClean, torrentClean);
    let extraWords = torrentWords.length - tmdbWords.length;

    let penalty;
    if (extraWords === 0) {
      penalty = 1.0;
    } else if (extraWords === 1) {
      penalty = 0.9;
    } else if (extraWords === 2) {
      penalty = 0.8;
    } else if (extraWords === 3) {
      penalty = 0.7;
    } else {
      penalty = Math.max(0.5, 1.0 - extraWords * 0.12);
    }

    if (densityAnalysis.isExcessive) {
      penalty *= 0.4;
    }

    let startsWithBonus = torrentClean.startsWith(tmdbWords.join(" ") + " ");
    let finalSimilarity = basicSimilarity * penalty;

    if (startsWithBonus && extraWords <= 3) {
      finalSimilarity = Math.min(1.0, finalSimilarity * 1.25);
    }

    // Palavras curtas ganham leve bônus
    let allShort = true;
    for (let i = 0; i < tmdbWords.length; i++) {
      if (tmdbWords[i].length > 3) {
        allShort = false;
        break;
      }
    }
    if (allShort && extraWords <= 2) {
      finalSimilarity = Math.min(1.0, finalSimilarity * 1.15);
    }

    let confidence;
    if (finalSimilarity >= 0.85) {
      confidence = "alta";
    } else if (finalSimilarity >= 0.7) {
      confidence = "média";
    } else {
      confidence = "baixa";
    }

    let reason;
    if (confidence === "alta") {
      reason = "Match forte: " + (finalSimilarity * 100).toFixed(1) + "%";
    } else if (confidence === "média") {
      reason = "Match moderado: " + (finalSimilarity * 100).toFixed(1) + "%";
    } else {
      reason = "Similaridade baixa: " + (finalSimilarity * 100).toFixed(1) + "%";
    }

    return {
      similarity: finalSimilarity,
      confidence: confidence,
      reason: reason,
      contextAnalysis: "título_duas_palavras:penalidade_" + penalty.toFixed(2)
    };
  }

  // Análise de densidade semântica
  analyzeSemanticDensity(tmdbWords, torrentWords) {
    if (!tmdbWords.length) {
      return { isExcessive: false, ratio: 0, reason: "TMDB sem palavras" };
    }
    let ratio = torrentWords.length / tmdbWords.length;
    let isExcessive = ratio >= 2.0 || (tmdbWords.length === 1 && torrentWords.length >= 2) || (tmdbWords.length === 2 && torrentWords.length >= 4);
    let reason = isExcessive
      ? "Densidade excessiva: " + torrentWords.length + " vs " + tmdbWords.length
      : "Densidade normal";
    return { isExcessive: isExcessive, ratio: ratio, reason: reason };
  }

  // Contexto global para títulos de uma palavra
  analyzeGlobalContext(tmdbWord, torrentWords) {
    let idx = -1;
    for (let i = 0; i < torrentWords.length; i++) {
      if (torrentWords[i] === tmdbWord) {
        idx = i;
        break;
      }
    }
    if (idx === -1) {
      return { hasStrongContext: false, reason: "Palavra TMDB não encontrada" };
    }
    if (tmdbWord.length <= 3 && torrentWords.length >= 2) {
      return { hasStrongContext: false, reason: "Título muito curto (" + tmdbWord.length + " letras) com contexto expandido" };
    }
    if (tmdbWord.length <= 5 && torrentWords.length >= 3) {
      return { hasStrongContext: false, reason: "Título curto com muito contexto adicional" };
    }
    if (torrentWords.length >= 3) {
      return { hasStrongContext: false, reason: "Contexto muito expandido para título único" };
    }
    return { hasStrongContext: true, reason: "Contexto apropriado" };
  }

  // Análise para títulos com três ou mais palavras
  normalContextAnalysis(torrentClean, tmdbClean, mediaType, targetSeason, originalTorrentTitle) {
    let basicSimilarity = this.calculateEnhancedSimilarity(torrentClean, tmdbClean);
    let density = this.analyzeWordDensity(torrentClean, tmdbClean);
    let containment = this.analyzeIntelligentContainment(torrentClean, tmdbClean);

    let finalSimilarity = basicSimilarity;

    if (density.hasExcessiveWords) {
      finalSimilarity *= 0.6;
    }

    if (containment.contains) {
      finalSimilarity = Math.min(1.0, finalSimilarity + 0.2);
    } else if (containment.contained) {
      let bonus = 0.15;
      if (mediaType === "movie" && this.extractSequenceNumber(tmdbClean)) {
        bonus = 0.05;
      }
      finalSimilarity = Math.min(1.0, finalSimilarity + bonus);
    }

    if (density.hasGoodContext) {
      finalSimilarity = Math.min(1.0, finalSimilarity + 0.1);
    }

    // Série com temporada explícita
    if (mediaType === "tv" && targetSeason && originalTorrentTitle) {
      if (this.hasExplicitSeason(originalTorrentTitle, targetSeason)) {
        let seasonBonus = 0.1;
        if (this.hasExplicitEpisode(originalTorrentTitle)) {
          seasonBonus += 0.05;
        }
        finalSimilarity = Math.min(1.0, finalSimilarity + seasonBonus);
      }
    }

    let confidence;
    if (finalSimilarity >= 0.85) {
      confidence = "alta";
    } else if (finalSimilarity >= 0.7) {
      confidence = "média";
    } else {
      confidence = "baixa";
    }

    let reason = "Match " + confidence + ": " + (finalSimilarity * 100).toFixed(1) + "%";
    if (density.hasExcessiveWords) {
      reason += " (muitas palavras extras)";
    }
    if (containment.contains) {
      reason += " (torrent contém TMDB)";
    } else if (containment.contained) {
      reason += " (TMDB contém torrent)";
    }
    if (mediaType === "tv" && targetSeason && originalTorrentTitle && this.hasExplicitSeason(originalTorrentTitle, targetSeason)) {
      reason += " [TEMPORADA: S" + targetSeason + " explícita]";
    }

    return {
      similarity: finalSimilarity,
      confidence: confidence,
      reason: reason,
      contextAnalysis: "normal:" + (basicSimilarity * 100).toFixed(1)
    };
  }

  // Verifica se o título contém indicação explícita da temporada
  hasExplicitSeason(title, season) {
    let lower = title.toLowerCase();
    let padded = season.toString().padStart(2, "0");
    let patterns = [
      "s" + padded,
      "s" + season,
      "season " + season,
      "temporada " + season,
      "temporada " + season + "ª",
      " " + season + "ª temporada",
      "t" + season,
      "t" + padded
    ];
    for (let i = 0; i < patterns.length; i++) {
      if (lower.includes(patterns[i])) {
        return true;
      }
    }
    return false;
  }

  // Verifica se o título contém indicação de episódio
  hasExplicitEpisode(title) {
    return /\be\d{1,10}\b|\bep\d{1,10}\b|\bepisode \d{1,10}\b|\bepisódio \d{1,10}\b/i.test(title);
  }

  // Similaridade com peso maior para as primeiras palavras
  calculateEnhancedSimilarity(str1, str2) {
    let w1 = str1.split(" ").filter(function (w) { return w.length > 0; });
    let w2 = str2.split(" ").filter(function (w) { return w.length > 0; });
    if (w1.length === 0 || w2.length === 0) return 0;

    // Cria um conjunto para busca rápida
    let set1 = {};
    for (let i = 0; i < w1.length; i++) {
      set1[w1[i]] = true;
    }

    let total = 0;
    for (let i = 0; i < w2.length; i++) {
      if (set1[w2[i]]) {
        if (i < 2) {
          total += 1.3; // primeiras palavras valem mais
        } else {
          total += 1.0;
        }
      }
    }

    let maxPossible = 0;
    for (let i = 0; i < w2.length; i++) {
      if (i < 2) {
        maxPossible += 1.3;
      } else {
        maxPossible += 1.0;
      }
    }

    return maxPossible > 0 ? total / maxPossible : 0;
  }

  // Analisa a densidade de palavras (palavras com mais de 2 letras)
  analyzeWordDensity(torrentClean, tmdbClean) {
    function filterLong(arr) {
      return arr.filter(function (w) { return w.length > 2; });
    }

    let tw = filterLong(torrentClean.split(" "));
    let tmw = filterLong(tmdbClean.split(" "));
    if (tmw.length === 0) {
      return { hasExcessiveWords: false, hasGoodContext: false, wordRatio: 0, torrentWords: tw.length, tmdbWords: 0 };
    }

    let ratio = tw.length / tmw.length;
    let hasExcessiveWords = ratio > 2.0;
    let hasGoodContext = tw.length >= 3 && ratio <= 1.8;

    return {
      hasExcessiveWords: hasExcessiveWords,
      hasGoodContext: hasGoodContext,
      wordRatio: ratio,
      torrentWords: tw.length,
      tmdbWords: tmw.length
    };
  }

  // Verifica se um título contém o outro (apenas palavras significativas)
  analyzeIntelligentContainment(torrentClean, tmdbClean) {
    let contains = torrentClean.includes(tmdbClean);
    let contained = tmdbClean.includes(torrentClean);
    let tmdbWords = tmdbClean.split(" ").filter(function (w) { return w.length > 2; });
    return { contains: contains && tmdbWords.length > 2, contained: contained };
  }

  // Normaliza um título removendo caracteres especiais, palavras técnicas etc.
  normalizeForComparison(title, mediaType) {
    // Substitui entidades HTML
    let clean = title
      .replace(/&#(\d+);/g, function (match, dec) { return String.fromCharCode(Number(dec)); })
      .replace(/&ndash;|&mdash;|&amp;|&lt;|&gt;|&quot;|&#039;|&apos;/g, " ")
      .toLowerCase()
      // Remove acentos
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      // Substitui pontuação por espaço
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Tratamento de sequência para filmes
    let seqSuffix = "";
    if (mediaType === "movie") {
      let match = clean.match(/^(.+?)\s+(\d+|i{1,3}|iv|v|vi{0,3}|ix|x)$/i);
      if (match) {
        let seq = match[2].toLowerCase();
        let romanMap = { i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };
        let arabic = romanMap[seq] || seq;
        if (/^\d+$/.test(arabic) && parseInt(arabic, 10) <= 20) {
          seqSuffix = " " + arabic;
          clean = match[1];
        }
      }
    }

    // Substitui separadores por espaço
    clean = clean.replace(/[\/\.\-_:]/g, " ");

    // Remove palavras técnicas
    for (let i = 0; i < TECHNICAL_WORDS.length; i++) {
      let term = TECHNICAL_WORDS[i];
      if (!/^\d+$/.test(term)) {
        let regex = new RegExp("\\b" + term + "\\b", "gi");
        clean = clean.replace(regex, "");
      }
    }

    // Remove acrônimos técnicos
    for (let i = 0; i < TECHNICAL_ACRONYMS.length; i++) {
      let acr = TECHNICAL_ACRONYMS[i];
      let regex = new RegExp("\\b" + acr + "\\b", "gi");
      clean = clean.replace(regex, "");
    }

    // Remove resoluções, bitrates, codecs etc.
    clean = clean.replace(/\b\d{3,4}[pi]\b/gi, "");
    clean = clean.replace(/\b[0-9]+k\b/gi, "");
    clean = clean.replace(/\b[hx]\d{3}\b/gi, "");
    clean = clean.replace(/\b\d+\.\d+(?:ch)?\b/gi, "");
    // Remove números pequenos isolados (podem ser parte de temporadas, mas já tratados)
    clean = clean.replace(/\b\d{1,3}\b/g, "");
    // Remove números grandes (datas, etc.)
    clean = clean.replace(/\b\d{5,}\b/g, "");
    // Limpa espaços extras
    clean = clean.replace(/\s+/g, " ").trim();

    return clean + seqSuffix;
  }

  // Extrai o ano de um título (formato 19xx ou 20xx)
  extractYearFromTitle(title) {
    let match = title.match(/\b(19|20)\d{2}\b/);
    if (match) {
      return parseInt(match[0], 10);
    }
    return null;
  }

  // Similaridade simples baseada em palavras comuns
  calculateWordSimilarity(str1, str2) {
    let w1 = str1.split(" ").filter(function (w) { return w.length > 0; });
    let w2 = str2.split(" ").filter(function (w) { return w.length > 0; });
    if (w1.length === 0 || w2.length === 0) return 0;

    // Caso especial: primeira string é uma única palavra contida na segunda
    if (w1.length === 1 && w2.includes(w1[0])) return 1.0;

    let set1 = {};
    for (let i = 0; i < w1.length; i++) {
      set1[w1[i]] = true;
    }

    let common = 0;
    for (let i = 0; i < w2.length; i++) {
      if (set1[w2[i]]) {
        common++;
      }
    }
    return common / Math.max(w1.length, w2.length);
  }

  // Versão síncrona simples (não utiliza TMDB)
  smartTitleContainsCheckSync(torrentTitle, imdbTitle) {
    let nt = this.normalizeForComparison(torrentTitle, "");
    let ni = this.normalizeForComparison(imdbTitle, "");
    let sim = this.calculateWordSimilarity(nt, ni);
    if (sim >= 0.5) {
      return {
        matches: true,
        similarity: sim,
        reason: "Similaridade: " + (sim * 100).toFixed(1) + "%"
      };
    }
    return {
      matches: false,
      similarity: sim,
      reason: "Similaridade insuficiente"
    };
  }

  // Detecta séries facilmente confundíveis (ex: "story" vs "stories")
  detectConfusingSeries(torrentTitle, imdbTitle) {
    let tl = torrentTitle.toLowerCase();
    let il = imdbTitle.toLowerCase();
    for (let i = 0; i < this.confusingSeries.length; i++) {
      let c = this.confusingSeries[i];
      if (tl.includes(c.derivative) && il.includes(c.original)) {
        return { isConfusing: true, minSimilarity: c.minSimilarity };
      }
    }
    return { isConfusing: false, minSimilarity: 0 };
  }

  // Adiciona um par confuso
  addConfusingSeries(original, derivative, minSimilarity) {
    if (minSimilarity === undefined) minSimilarity = 0.8;
    this.confusingSeries.push({
      original: original.toLowerCase(),
      derivative: derivative.toLowerCase(),
      minSimilarity: minSimilarity
    });
  }

  // Lista séries confusas
  listConfusingSeries() {
    return this.confusingSeries;
  }

  // Limpa o cache TMDB
  clearCache() {
    this.tmdbCache.clear();
  }

  // Sugere uma query de busca com base no título e tipo
  suggestSearchQuery(baseTitle, type, season) {
    let clean = this.normalizeForComparison(baseTitle, "").trim();
    if (clean === "") clean = baseTitle;
    if (type === "series" && season !== undefined) {
      return clean + " s" + season.toString().padStart(2, "0") + " dual OR dublado";
    }
    return clean + " dual OR dublado";
  }

  // Termos de busca relacionados a idioma
  getLanguageSearchTerms() {
    return [
      "dublado", "dublada", "dublagem", "dual", "audio", "áudio",
      "legendado", "legendada", "legenda", "pt-br", "ptbr", "pt_br",
      "pt.br", "pt br", "português", "brazilian", "multi"
    ];
  }

  // Retorna estatísticas da versão
  getStats() {
    return {
      versão: this.VERSAO,
      limiarFilmes: "0.75",
      limiarSéries: "0.65",
      melhorias: [
        "Override contextual para séries com SxxExx",
        "Remoção de logs excessivos"
      ]
    };
  }
}

// Mapas estáticos
SimilarityCalculator.ROMAN_MAP = {
  i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10",
  xi: "11", xii: "12", xiii: "13", xiv: "14", xv: "15", xvi: "16", xvii: "17", xviii: "18", xix: "19", xx: "20"
};

SimilarityCalculator.SEQ_PATTERNS = [
  /part[ée]?\s*(\d+)/i,
  /pt\.?\s*(\d+)/i,
  /volume\s*(\d+)/i,
  /vol\.?\s*(\d+)/i,
  /filme\s*(\d+)/i,
  /movie\s*(\d+)/i,
  /edição\s*(\d+)/i,
  /edition\s*(\d+)/i,
  /seq(\d+)/i
];

// Exportação do módulo
module.exports = { SimilarityCalculator: SimilarityCalculator };