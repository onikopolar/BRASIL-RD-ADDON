/**
 * Detector de idioma português para títulos de torrent
 */

import { Logger } from '../../utils/logger';

export class LanguageDetector {
  private readonly logger: Logger;
  
  // ✅ INDICADORES FORTES DE PORTUGUÊS
  private readonly PORTUGUES_INDICATORS = [
    'dublado', 'dublada', 'dublagem', 'dubladores',
    'português', 'portugues', 'pt-br', 'ptbr', 'pt_br', 'pt.br', 'pt br',
    'legendado', 'legendada', 'legenda', 'legendas', 'legenda pt-br',
    'áudio português', 'audio portugues', 'audio pt-br',
    'brasil', 'brazil', 'br',
    'dual', 'dual áudio', 'dual audio', 'dual-audio',
    'multi', 'multilíngue', 'multilinguagem', 'multilanguage',
    'bludv', 'blu-dv', 'blu.dv', 'blu dv',
    'starck', 'stark', 'starkfilmes',
    'baixafilmes', 'baixa-filmes', 'baixafilmesbr',
    'comandotorrents', 'comando-torrents',
    'jumanji', 'jumanjitorrent',
    'downflix',
    'megalobitz', 'mega-lobitz',
    'hdtvbr', 'hdtv-br',
    'nacional', 'lançamento', 'lancamento', 'versão brasileira',
    'áudio dual', 'audio dual'
  ];
  
  // 🚫 INDICADORES DE INGLÊS PURO
  private readonly ENGLISH_ONLY_INDICATORS = [
    '(eng)', '[eng]', '{eng}', '|eng|', '.eng.', '_eng_',
    'english', 'inglês', 'ingles',
    'english audio', 'inglês audio', 'ingles audio',
    'only eng', 'somente inglês', 'apenas inglês',
    'no portuguese', 'sem português', 'without portuguese',
    'eng only', 'english only',
    /\(eng[^)]*\)/i,
    /\[eng[^\]]*\]/i,
  ];
  
  // Grupos internacionais
  private readonly INTERNATIONAL_GROUPS = [
    'yts', 'rarbg', 'ettv', 'eztv', 'skgtv', 'rartv', 'turbotorrent'
  ];
  
  // Tags comuns em inglês
  private readonly COMMON_ENGLISH_TAGS = [
    'webrip', 'web-dl', 'hdtv', 'bluray', 'x264', 'x265', 'h264', 'h265'
  ];
  
  // Padrões comuns em releases BR
  private readonly BR_PATTERNS = [
    /\d+\s*ª?\s*temporada/i,  // Xª Temporada
    /completa\s*\d+\s*temporada/i,
    /season\s*\d+\s*complete/i,
    /\d+\s*epis[oó]dios/i
  ];
  
  // Palavras-chave relevantes para verificação
  private readonly KEYWORD_CHECKS = [
    {
      keywords: ['horror story', 'historia de horror'],
      description: 'Título relevante para American Horror Story'
    },
    {
      keywords: ['breaking bad', 'breaking bad'],
      description: 'Título relevante para Breaking Bad'
    }
  ];

  constructor() {
    this.logger = new Logger('LanguageDetector');
  }

  /**
   * VERIFICA SE O CONTEÚDO ESTÁ EM PORTUGUÊS
   */
  isPortugueseContent(torrentTitle: string): boolean {
    this.logger.debug('🔍 Verificando se conteúdo está em português', {
      title: torrentTitle.substring(0, 80)
    });

    const titleLower = torrentTitle.toLowerCase();
    
    // 🔥 CORREÇÃO CRÍTICA: Verifica DUAL ÁUDIO primeiro
    const isDualAudio = this.isExplicitDualAudio(titleLower);
    if (isDualAudio) {
      this.logAcceptance('Dual áudio explícito detectado', torrentTitle);
      return true;
    }
    
    // 1. Verifica inglês puro
    const hasEnglishOnly = this.hasEnglishOnlyIndicator(titleLower);
    if (hasEnglishOnly) {
      this.logRejection('Inglês puro detectado', torrentTitle);
      return false;
    }
    
    // 2. Verifica português
    const hasPortuguese = this.hasPortugueseIndicator(titleLower);
    if (hasPortuguese) {
      this.logAcceptance('Português detectado', torrentTitle);
      return true;
    }
    
    // 3. Termina com (eng) → REJEITA
    if (this.endsWithEnglishIndicator(titleLower)) {
      this.logRejection('Termina com indicador de inglês', torrentTitle);
      return false;
    }
    
    // 4. Grupo internacional + tags inglesas → REJEITA
    if (this.isInternationalEnglishOnly(titleLower)) {
      this.logRejection('Grupo internacional sem português', torrentTitle);
      return false;
    }
    
    // 5. CORREÇÃO: Análise contextual para benefício da dúvida
    const hasBRPatterns = this.hasBRPatterns(titleLower);
    if (hasBRPatterns) {
      // Tem padrão BR, dá benefício da dúvida
      this.logAcceptance('Benefício da dúvida (padrão BR)', torrentTitle);
      return true;
    }
    
    // 6. Verificação de palavras-chave relevantes
    const hasRelevantKeywords = this.hasRelevantKeywords(titleLower);
    if (hasRelevantKeywords) {
      this.logAcceptance('Benefício da dúvida (palavras-chave)', torrentTitle);
      return true;
    }
    
    // 7. Se não tem indicadores claros → REJEITA
    this.logRejection('Título irrelevante', torrentTitle);
    return false;
  }

  /**
   * 🔥 NOVO MÉTODO: Detecta explicitamente dual audio
   */
private isExplicitDualAudio(titleLower: string): boolean {
  // Lista de combinações que indicam dual audio em português
  const dualAudioCombinations = [
    // Combinações com "dual"
    'dual audio português',
    'dual áudio português', 
    'dual audio pt',
    'dual áudio pt',
    'dual audio portugues',
    'dual áudio portugues',
    
    // Combinações com "+" ou "e"
    'português + inglês',
    'português e inglês',
    'portugues + ingles',
    'portugues e ingles',
    'pt + eng',
    'pt e eng',
    'pt-br + eng',
    'pt-br e eng',
    
    // Combinações com "dual audio" e qualquer menção a português
    'dual audio', // Se tiver "dual audio" e depois mencionar português em qualquer lugar
    'dual áudio'
  ];
  
  // Verifica combinações exatas
  for (const combination of dualAudioCombinations) {
    if (titleLower.includes(combination)) {
      // Se for apenas "dual audio" ou "dual áudio", verifica se também menciona português
      if ((combination === 'dual audio' || combination === 'dual áudio')) {
        const hasPortuguese = titleLower.includes('português') || 
                             titleLower.includes('portugues') || 
                             titleLower.includes('pt') ||
                             titleLower.includes('pt-br');
        if (hasPortuguese) {
          this.logger.debug('🔥 Dual áudio com português detectado', {
            title: titleLower.substring(0, 80),
            combination
          });
          return true;
        }
      } else {
        this.logger.debug('🔥 Dual áudio detectado (combinação exata)', {
          title: titleLower.substring(0, 80),
          combination
        });
        return true;
      }
    }
  }
  
  return false;
}

  /**
   * Verifica se tem indicadores de inglês puro
   */
private hasEnglishOnlyIndicator(titleLower: string): boolean {
  // Primeiro, verifica se é claramente português (dublado/legendado + pt/português)
  const hasStrongPortuguese = 
    (titleLower.includes('dublado') || titleLower.includes('legendado')) &&
    (titleLower.includes('português') || titleLower.includes('portugues') || titleLower.includes('pt'));
  
  if (hasStrongPortuguese) {
    // Se tem indicação forte de português, ignora verificações de inglês
    return false;
  }
  
  // Depois verifica inglês puro normalmente
  return this.ENGLISH_ONLY_INDICATORS.some(indicator => {
    if (typeof indicator === 'string') {
      return titleLower.includes(indicator);
    } else if (indicator instanceof RegExp) {
      return indicator.test(titleLower);
    }
    return false;
  });
}

  /**
   * Verifica se tem indicadores de português
   */
  private hasPortugueseIndicator(titleLower: string): boolean {
    return this.PORTUGUES_INDICATORS.some(indicator =>
      titleLower.includes(indicator)
    );
  }

  /**
   * Verifica se termina com indicador de inglês
   */
  private endsWithEnglishIndicator(titleLower: string): boolean {
    return titleLower.match(/\(eng\)$|\[eng\]$|\{eng\}$|\.eng$/) !== null;
  }

  /**
   * Verifica se é grupo internacional sem português
   */
  private isInternationalEnglishOnly(titleLower: string): boolean {
    const hasInternationalGroup = this.INTERNATIONAL_GROUPS.some(group => 
      titleLower.includes(group)
    );
    const hasEnglishTags = this.COMMON_ENGLISH_TAGS.some(tag => 
      titleLower.includes(tag)
    );
    
    return hasInternationalGroup && hasEnglishTags;
  }

  /**
   * Verifica se tem padrões BR
   */
  private hasBRPatterns(titleLower: string): boolean {
    return this.BR_PATTERNS.some(pattern => pattern.test(titleLower));
  }

  /**
   * Verifica se tem palavras-chave relevantes
   */
  private hasRelevantKeywords(titleLower: string): boolean {
    for (const check of this.KEYWORD_CHECKS) {
      if (check.keywords.some(keyword => titleLower.includes(keyword))) {
        this.logger.debug('✅ Palavras-chave relevantes encontradas', {
          title: titleLower.substring(0, 80),
          keywords: check.keywords,
          description: check.description
        });
        return true;
      }
    }
    return false;
  }

  /**
   * Log de aceitação
   */
  private logAcceptance(reason: string, torrentTitle: string): void {
    this.logger.debug(`✅ ACEITO - ${reason}`, {
      torrentTitle: torrentTitle.substring(0, 80),
      reason: reason
    });
  }

  /**
   * Log de rejeição
   */
  private logRejection(reason: string, torrentTitle: string): void {
    this.logger.debug(`❌ REJEITADO - ${reason}`, {
      torrentTitle: torrentTitle.substring(0, 80),
      reason: reason
    });
  }

  /**
   * Adiciona indicador de português
   */
  addPortugueseIndicator(indicator: string): void {
    this.PORTUGUES_INDICATORS.push(indicator.toLowerCase());
  }

  /**
   * Adiciona indicador de inglês
   */
  addEnglishIndicator(indicator: string | RegExp): void {
    this.ENGLISH_ONLY_INDICATORS.push(indicator);
  }

  /**
   * Adiciona grupo internacional
   */
  addInternationalGroup(group: string): void {
    this.INTERNATIONAL_GROUPS.push(group.toLowerCase());
  }

  /**
   * Adiciona tag em inglês
   */
  addEnglishTag(tag: string): void {
    this.COMMON_ENGLISH_TAGS.push(tag.toLowerCase());
  }

  /**
   * Adiciona padrão BR
   */
  addBRPattern(pattern: RegExp): void {
    this.BR_PATTERNS.push(pattern);
  }

  /**
   * Adiciona verificação de palavras-chave
   */
  addKeywordCheck(keywords: string[], description: string): void {
    this.KEYWORD_CHECKS.push({ keywords, description });
  }

  /**
   * Obtém estatísticas dos indicadores
   */
  getIndicatorStats() {
    return {
      portugueseIndicators: this.PORTUGUES_INDICATORS.length,
      englishIndicators: this.ENGLISH_ONLY_INDICATORS.length,
      internationalGroups: this.INTERNATIONAL_GROUPS.length,
      englishTags: this.COMMON_ENGLISH_TAGS.length,
      brPatterns: this.BR_PATTERNS.length,
      keywordChecks: this.KEYWORD_CHECKS.length
    };
  }
}