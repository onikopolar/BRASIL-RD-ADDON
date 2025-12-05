import { Logger } from '../../utils/logger';

export class LanguageDetector {
  private readonly logger: Logger;
  
  // Versionamento Semântico - atualize aqui ao fazer mudanças
  private readonly VERSION = '2.2.0';
  
  // Indicadores de português
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
  
  // Indicadores de inglês puro
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
  
  // Grupos internacionais (geralmente inglês)
  private readonly INTERNATIONAL_GROUPS = [
    'yts', 'rarbg', 'ettv', 'eztv', 'skgtv', 'rartv', 'turbotorrent'
  ];
  
  // Tags técnicas comuns em releases
  private readonly COMMON_TECH_TAGS = [
    'webrip', 'web-dl', 'hdtv', 'bluray', 'x264', 'x265', 'h264', 'h265'
  ];
  
  // Padrões BR (séries, temporadas, episódios)
  private readonly BR_PATTERNS = [
    /\d+\s*ª?\s*temporada/i,
    /completa\s*\d+\s*temporada/i,
    /season\s*\d+\s*complete/i,
    /\d+\s*epis[oó]dios/i
  ];
  
  // Palavras-chave para séries populares
  private readonly KEYWORD_CHECKS = [
    {
      keywords: ['horror story', 'historia de horror'],
      description: 'American Horror Story'
    },
    {
      keywords: ['breaking bad'],
      description: 'Breaking Bad'
    }
  ];

  constructor() {
    this.logger = new Logger('LanguageDetector');
    this.logger.info(`LanguageDetector v${this.VERSION} iniciado - Foco em detecção de idioma`);
  }

  // Método principal: detecta se conteúdo está em português
  isPortugueseContent(torrentTitle: string): boolean {
    const titleLower = torrentTitle.toLowerCase();
    
    // Debug: título sendo analisado
    this.logger.debug('Analisando idioma', {
      title: torrentTitle.substring(0, 80)
    });

    // 1. Verifica dual áudio com português
    const hasPortugueseDualAudio = this.hasPortugueseDualAudio(titleLower);
    if (hasPortugueseDualAudio) {
      this.logger.debug('Aceito: Dual áudio com português', {
        title: torrentTitle.substring(0, 60)
      });
      return true;
    }
    
    // 2. Verifica inglês puro (deve rejeitar)
    const isEnglishOnly = this.isEnglishOnlyContent(titleLower);
    if (isEnglishOnly) {
      this.logger.debug('Rejeitado: Conteúdo apenas em inglês', {
        title: torrentTitle.substring(0, 60)
      });
      return false;
    }
    
    // 3. Verifica indicadores de português
    const hasPortugueseIndicators = this.hasPortugueseIndicators(titleLower);
    if (hasPortugueseIndicators) {
      this.logger.debug('Aceito: Indicadores de português', {
        title: torrentTitle.substring(0, 60)
      });
      return true;
    }
    
    // 4. Verifica padrões BR (séries, temporadas)
    const hasBRPatterns = this.hasBRPatterns(titleLower);
    if (hasBRPatterns) {
      this.logger.debug('Aceito: Padrão BR detectado', {
        title: torrentTitle.substring(0, 60)
      });
      return true;
    }
    
    // 5. Verifica palavras-chave relevantes
    const hasRelevantKeywords = this.hasRelevantKeywords(titleLower);
    if (hasRelevantKeywords) {
      this.logger.debug('Aceito: Palavras-chave relevantes', {
        title: torrentTitle.substring(0, 60)
      });
      return true;
    }
    
    // 6. Títulos curtos: benefício da dúvida
    const isShortTitle = this.isShortTitle(torrentTitle);
    if (isShortTitle) {
      this.logger.debug('Aceito: Título curto - benefício da dúvida', {
        title: torrentTitle.substring(0, 60)
      });
      return true;
    }
    
    // 7. Rejeita por falta de indicadores claros
    this.logger.debug('Rejeitado: Sem indicadores claros de português', {
      title: torrentTitle.substring(0, 60)
    });
    return false;
  }

  // Verifica dual áudio que inclui português
  private hasPortugueseDualAudio(titleLower: string): boolean {
    const dualAudioPatterns = [
      'dual audio português',
      'dual áudio português', 
      'dual audio pt',
      'dual áudio pt',
      'dual audio portugues',
      'dual áudio portugues',
      'português + inglês',
      'português e inglês',
      'portugues + ingles',
      'portugues e ingles',
      'pt + eng',
      'pt e eng',
      'pt-br + eng',
      'pt-br e eng'
    ];
    
    // Verifica combinações explícitas
    for (const pattern of dualAudioPatterns) {
      if (titleLower.includes(pattern)) {
        return true;
      }
    }
    
    // Verifica "dual áudio" ou "dual audio" com indicador de português
    if (titleLower.includes('dual audio') || titleLower.includes('dual áudio')) {
      const hasPortuguese = titleLower.includes('português') || 
                           titleLower.includes('portugues') || 
                           titleLower.includes('pt') ||
                           titleLower.includes('pt-br');
      return hasPortuguese;
    }
    
    return false;
  }

  // Verifica se é conteúdo apenas em inglês
  private isEnglishOnlyContent(titleLower: string): boolean {
    // Se tem indicadores fortes de português, não é inglês puro
    const hasStrongPortuguese = 
      (titleLower.includes('dublado') || titleLower.includes('legendado')) &&
      (titleLower.includes('português') || titleLower.includes('portugues') || titleLower.includes('pt'));
    
    if (hasStrongPortuguese) {
      return false;
    }
    
    // Verifica indicadores de inglês puro
    const hasEnglishOnly = this.ENGLISH_ONLY_INDICATORS.some(indicator => {
      if (typeof indicator === 'string') {
        return titleLower.includes(indicator);
      } else if (indicator instanceof RegExp) {
        return indicator.test(titleLower);
      }
      return false;
    });
    
    if (hasEnglishOnly) {
      return true;
    }
    
    // Verifica se termina com (eng)
    const endsWithEnglish = titleLower.match(/\(eng\)$|\[eng\]$|\{eng\}$|\.eng$/) !== null;
    if (endsWithEnglish) {
      return true;
    }
    
    // Verifica grupos internacionais sem português
    const hasInternationalGroup = this.INTERNATIONAL_GROUPS.some(group => 
      titleLower.includes(group)
    );
    const hasTechTags = this.COMMON_TECH_TAGS.some(tag => 
      titleLower.includes(tag)
    );
    
    return hasInternationalGroup && hasTechTags && !this.hasPortugueseIndicators(titleLower);
  }

  // Verifica indicadores de português
  private hasPortugueseIndicators(titleLower: string): boolean {
    return this.PORTUGUES_INDICATORS.some(indicator =>
      titleLower.includes(indicator)
    );
  }

  // Verifica padrões BR (séries, temporadas, episódios)
  private hasBRPatterns(titleLower: string): boolean {
    return this.BR_PATTERNS.some(pattern => pattern.test(titleLower));
  }

  // Verifica palavras-chave relevantes
  private hasRelevantKeywords(titleLower: string): boolean {
    for (const check of this.KEYWORD_CHECKS) {
      if (check.keywords.some(keyword => titleLower.includes(keyword))) {
        return true;
      }
    }
    return false;
  }

  // Verifica se é título curto (até 5 palavras)
  private isShortTitle(torrentTitle: string): boolean {
    const cleanTitle = torrentTitle
      .replace(/[^\w\s]|_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    const words = cleanTitle.split(' ').filter(w => w.length > 0);
    return words.length <= 5;
  }

  // Métodos para extensão dinâmica

  addPortugueseIndicator(indicator: string): void {
    this.PORTUGUES_INDICATORS.push(indicator.toLowerCase());
    this.logger.debug('Indicador de português adicionado', { indicator });
  }

  addEnglishIndicator(indicator: string | RegExp): void {
    this.ENGLISH_ONLY_INDICATORS.push(indicator);
    this.logger.debug('Indicador de inglês adicionado', { 
      indicator: indicator instanceof RegExp ? indicator.toString() : indicator 
    });
  }

  addInternationalGroup(group: string): void {
    this.INTERNATIONAL_GROUPS.push(group.toLowerCase());
    this.logger.debug('Grupo internacional adicionado', { group });
  }

  addTechTag(tag: string): void {
    this.COMMON_TECH_TAGS.push(tag.toLowerCase());
    this.logger.debug('Tag técnica adicionada', { tag });
  }

  addBRPattern(pattern: RegExp): void {
    this.BR_PATTERNS.push(pattern);
    this.logger.debug('Padrão BR adicionado', { pattern: pattern.toString() });
  }

  addKeywordCheck(keywords: string[], description: string): void {
    this.KEYWORD_CHECKS.push({ keywords, description });
    this.logger.debug('Palavras-chave adicionadas', { description, keywords });
  }

  // Estatísticas para debugging
  getIndicatorStats() {
    return {
      version: this.VERSION,
      portugueseIndicators: this.PORTUGUES_INDICATORS.length,
      englishIndicators: this.ENGLISH_ONLY_INDICATORS.length,
      internationalGroups: this.INTERNATIONAL_GROUPS.length,
      techTags: this.COMMON_TECH_TAGS.length,
      brPatterns: this.BR_PATTERNS.length,
      keywordChecks: this.KEYWORD_CHECKS.length
    };
  }

  // Log de configuração atual
  logCurrentConfig(): void {
    this.logger.info('Configuração atual LanguageDetector', this.getIndicatorStats());
  }
}