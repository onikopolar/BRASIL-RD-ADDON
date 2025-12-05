import { Logger } from '../../utils/logger';
import axios from 'axios';
import * as cheerio from 'cheerio';

export class TitleTranslator {
  private readonly logger: Logger;
  private readonly GOOGLE_TRANSLATE_URL = 'https://translate.google.com/m';
  private requestDelay: number = 500; // 0.5 segundos entre requests
  
  // Dicionário de traduções conhecidas (português -> inglês oficial)
  private readonly knownTranslations: Map<string, string> = new Map([
    // Filmes/Séries específicos - TÍTULOS COMPLETOS
    ['os mercenarios', 'the expendables'],
    ['os mercenários', 'the expendables'],
    ['a casa do dragao', 'house of the dragon'],
    ['a casa do dragão', 'house of the dragon'],
    ['casa do dragao', 'house of the dragon'],
    ['casa do dragão', 'house of the dragon'],
    ['doutor estranho', 'doctor strange'],
    ['doutor estranho no multiverso da loucura', 'doctor strange in the multiverse of madness'],
    ['senhor dos aneis', 'lord of the rings'],
    ['senhor dos anéis', 'lord of the rings'],
    ['o senhor dos aneis', 'the lord of the rings'],
    ['o senhor dos anéis', 'the lord of the rings'],
    ['assassinos da lua', 'killers of the flower moon'],
    ['assassinos da lua das flores', 'killers of the flower moon'],
    ['missao impossivel', 'mission impossible'],
    ['missão impossível', 'mission impossible'],
    ['vingadores', 'avengers'],
    ['vingadores ultimato', 'avengers endgame'],
    ['vingadores guerra infinita', 'avengers infinity war'],
    ['vingadores era de ultron', 'avengers age of ultron'],
    ['homem aranha', 'spider man'],
    ['homem aranha no aranhaverso', 'spider man into the spider verse'],
    ['homem aranha através do aranhaverso', 'spider man across the spider verse'],
    ['batman', 'batman'],
    ['superman', 'superman'],
    ['wolverine', 'wolverine'],
    ['panico', 'scream'],
    ['pânico', 'scream'],
    ['o poderoso chefao', 'the godfather'],
    ['o poderoso chefão', 'the godfather'],
    ['avatar', 'avatar'],
    ['star wars', 'star wars'],
    ['guerra nas estrelas', 'star wars'],
    ['coringa', 'joker'],
    ['o homem de aco', 'man of steel'],
    ['o homem de aço', 'man of steel'],
    ['mulher maravilha', 'wonder woman'],
    ['liga da justica', 'justice league'],
    ['aquaman', 'aquaman'],
    ['flash', 'flash'],
    ['aranhaverso', 'spider verse'],
    ['viuva negra', 'black widow'],
    ['thor', 'thor'],
    ['capitao america', 'captain america'],
    ['homem de ferro', 'iron man'],
    ['hulk', 'hulk'],
    
    // Termos comuns - IMPORTANTE: adicionados para tradução completa
    ['temporada', 'season'],
    ['dublado', 'dubbed'],
    ['legendado', 'subtitled'],
    ['episodio', 'episode'],
    ['episódio', 'episode'],
    ['filme', 'movie'],
    ['serie', 'series'],
    ['série', 'series'],
    ['hd', 'hd'],
    ['fullhd', 'full hd'],
    ['4k', '4k'],
    ['bluray', 'bluray'],
    ['webdl', 'web dl'],
    ['hdtv', 'hdtv'],
    ['no', 'in'],
    ['na', 'in the'],
    ['nas', 'in the'],
    ['nos', 'in the'],
    ['da', 'of the'],
    ['do', 'of the'],
    ['das', 'of the'],
    ['dos', 'of the'],
    ['de', 'of'],
    ['em', 'in'],
    ['com', 'with'],
    ['sem', 'without'],
    ['para', 'for'],
    ['por', 'by'],
    ['a', 'the'],
    ['o', 'the'],
    ['as', 'the'],
    ['os', 'the'],
    ['um', 'a'],
    ['uma', 'a'],
    ['ao', 'to the'],
    ['à', 'to the'],
    ['aos', 'to the'],
    ['às', 'to the']
  ]);

  constructor() {
    this.logger = new Logger('TitleTranslator');
  }

  /**
   * Traduz título COMPLETO com foco em precisão
   */
  async translateTitle(fullTitle: string): Promise<string> {
    this.logger.debug('Iniciando tradução de título', {
      original: fullTitle.substring(0, 80)
    });

    // 1. Normalizar título (remove acentos, pontuação, espaços extras)
    const normalizedTitle = this.normalizeTitle(fullTitle);
    
    // 2. PRIMEIRO: Tentar traduzir usando APENAS o dicionário
    const dictionaryTranslation = this.translateWithDictionary(normalizedTitle);
    
    // Se conseguimos traduzir TUDO com o dicionário, retorna
    if (dictionaryTranslation && this.isFullyTranslated(normalizedTitle, dictionaryTranslation)) {
      this.logger.debug('✅ Tradução completa via dicionário', {
        original: normalizedTitle.substring(0, 60),
        translated: dictionaryTranslation.substring(0, 60)
      });
      return dictionaryTranslation;
    }
    
    // 3. SEGUNDO: Usar Google Translate para o que falta
    try {
      await this.delay(this.requestDelay);
      
      const response = await axios.get(this.GOOGLE_TRANSLATE_URL, {
        params: {
          sl: 'pt', // Portuguese
          tl: 'en', // English
          q: fullTitle
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        timeout: 5000
      });

      const $ = cheerio.load(response.data);
      const translatedText = $('.result-container').text().trim();
      
      if (translatedText && translatedText.length > 0) {
        const googleTranslation = this.cleanTranslatedText(translatedText);
        
        this.logger.debug('🌐 Tradução via Google Translate', {
          original: normalizedTitle.substring(0, 60),
          google: googleTranslation.substring(0, 60)
        });
        
        // 4. COMBINAR: Usar dicionário para melhorar a tradução do Google
        const finalTranslation = this.combineTranslations(normalizedTitle, googleTranslation);
        
        return finalTranslation;
      }
      
      // Fallback: usa tradução do dicionário ou título original
      return dictionaryTranslation || normalizedTitle;
      
    } catch (error) {
      this.logger.warn('Falha ao traduzir título', {
        title: normalizedTitle.substring(0, 60),
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
      
      return dictionaryTranslation || normalizedTitle;
    }
  }

  /**
   * Traduz usando APENAS o dicionário (palavra por palavra/frases)
   */
  private translateWithDictionary(title: string): string {
    const words = title.split(' ').filter(w => w.length > 0);
    if (words.length === 0) return '';
    
    const translatedWords: string[] = [];
    
    for (let i = 0; i < words.length; i++) {
      let translated = false;
      
      // Tentar frases de 4 palavras (mais longas primeiro)
      for (let phraseLength = 4; phraseLength >= 1; phraseLength--) {
        if (i + phraseLength <= words.length) {
          const phrase = words.slice(i, i + phraseLength).join(' ');
          
          if (this.knownTranslations.has(phrase)) {
            translatedWords.push(this.knownTranslations.get(phrase) || phrase);
            i += phraseLength - 1; // Avança as palavras da frase
            translated = true;
            break;
          }
        }
      }
      
      // Se não encontrou frase, tentar palavra individual
      if (!translated) {
        const word = words[i];
        if (this.knownTranslations.has(word)) {
          translatedWords.push(this.knownTranslations.get(word) || word);
        } else {
          translatedWords.push(word); // Mantém original
        }
      }
    }
    
    return translatedWords.join(' ');
  }

  /**
   * Combina tradução do Google com dicionário para melhor precisão
   */
  private combineTranslations(original: string, googleTranslation: string): string {
    // Se temos tradução completa no dicionário, usa ela
    const dictTranslation = this.translateWithDictionary(original);
    
    // Se o dicionário traduziu algo, usa como base
    if (dictTranslation && dictTranslation !== original) {
      // Mas verifica se o Google tem algo melhor para partes não traduzidas
      const dictWords = dictTranslation.split(' ');
      const originalWords = original.split(' ');
      
      // Para palavras que não foram traduzidas no dicionário, tenta usar o Google
      const finalWords = dictWords.map((dictWord, index) => {
        if (index < originalWords.length && dictWord === originalWords[index]) {
          // Esta palavra não foi traduzida pelo dicionário
          // Tenta encontrar no Google translation
          const googleWords = googleTranslation.split(' ');
          if (index < googleWords.length && googleWords[index] !== originalWords[index]) {
            return googleWords[index]; // Usa tradução do Google
          }
        }
        return dictWord;
      });
      
      return finalWords.join(' ');
    }
    
    // Se dicionário não ajudou, usa Google puro
    return googleTranslation;
  }

  /**
   * Verifica se a tradução cobriu todo o título
   */
  private isFullyTranslated(original: string, translation: string): boolean {
    // Se todas as palavras do original foram alteradas na tradução
    const originalWords = original.split(' ').filter(w => w.length > 0);
    const translationWords = translation.split(' ').filter(w => w.length > 0);
    
    if (originalWords.length !== translationWords.length) return false;
    
    // Conta quantas palavras são diferentes
    let changedWords = 0;
    for (let i = 0; i < originalWords.length; i++) {
      if (originalWords[i] !== translationWords[i]) {
        changedWords++;
      }
    }
    
    // Considera "completamente traduzido" se pelo menos 70% das palavras mudaram
    return changedWords >= originalWords.length * 0.7;
  }

  /**
   * Normaliza título para comparação (remove acentos, pontuação, etc)
   */
  private normalizeTitle(title: string): string {
    return title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove acentos
      .replace(/[^\w\s]/g, ' ') // Remove pontuação
      .replace(/\s+/g, ' ') // Espaços múltiplos para simples
      .trim();
  }

  /**
   * Limpa texto traduzido
   */
  private cleanTranslatedText(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Delay para rate limiting
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Verifica se já é match direto (título já em inglês)
   */
  isAlreadyEnglish(title: string): boolean {
    const portugueseWords = [
      'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
      'por', 'para', 'com', 'sem', 'o', 'a', 'os', 'as', 'um', 'uma',
      'ao', 'à', 'aos', 'às', 'num', 'numa', 'nuns', 'numas',
      'dublado', 'legendado', 'temporada', 'episodio', 'episódio'
    ];
    
    const words = title.toLowerCase().split(' ');
    const portugueseCount = words.filter(w => portugueseWords.includes(w)).length;
    const totalWords = words.length;
    
    return totalWords > 0 && (portugueseCount / totalWords) < 0.3;
  }

  /**
   * Adiciona nova tradução ao dicionário
   */
  addTranslation(portuguese: string, english: string): void {
    const key = this.normalizeTitle(portuguese);
    const value = english.toLowerCase().trim();
    this.knownTranslations.set(key, value);
    
    this.logger.debug('➕ Tradução adicionada ao dicionário', {
      portuguese: key,
      english: value
    });
  }

  /**
   * Verifica se uma frase está no dicionário (para debugging)
   */
  hasTranslation(phrase: string): boolean {
    const normalized = this.normalizeTitle(phrase);
    return this.knownTranslations.has(normalized);
  }

  /**
   * Obtém todas as traduções (para debugging)
   */
  getAllTranslations(): { [key: string]: string } {
    const result: { [key: string]: string } = {};
    this.knownTranslations.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }

  /**
   * Obtém estatísticas
   */
  getStats() {
    return {
      translatorType: 'Google Translate + Dicionário Avançado',
      requestDelay: this.requestDelay,
      knownTranslations: this.knownTranslations.size,
      features: [
        'Tradução palavra por palavra',
        'Tradução de frases completas',
        'Combinação Google + Dicionário',
        'Rate limiting automático'
      ]
    };
  }
}