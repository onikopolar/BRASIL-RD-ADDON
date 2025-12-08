import { Logger } from '../../utils/logger';
import { 
  TECHNICAL_WORDS,
  INTERNATIONAL_RELEASE_GROUPS,
  INTERNATIONAL_TRACKERS,
  BRAZILIAN_RELEASE_GROUPS,
  containsInternationalIndicators,
  containsBrazilianIndicators,
  isTechnicalWord
} from '../../lib/title-filter/TechnicalWords';

export class LanguageDetector {
  private readonly logger: Logger;
  
  // Versionamento Semântico - MINOR: integração com TechnicalWords e melhor detecção
  private readonly VERSION = '2.3.0';
  
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
  
  // Grupos internacionais (geralmente inglês) - agora usando da TechnicalWords
  private readonly INTERNATIONAL_GROUPS = [
    ...INTERNATIONAL_RELEASE_GROUPS,
    'yts', 'rarbg', 'ettv', 'eztv', 'skgtv', 'rartv', 'turbotorrent'
  ];
  
  // Tags técnicas comuns em releases - agora integrado com TechnicalWords
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
    this.logger.info(`LanguageDetector v${this.VERSION} iniciado`);
    this.logger.debug(`Integrado com TechnicalWords - Detecção aprimorada de releases`);
  }

  // Método principal: detecta se conteúdo está em português
  isPortugueseContent(torrentTitle: string): boolean {
    const titleLower = torrentTitle.toLowerCase();
    
    this.logger.debug('Analisando idioma do título', {
      title: torrentTitle.substring(0, 80),
      versao: this.VERSION
    });

    // 1. Verificação avançada de grupos internacionais
    const intlCheck = this.checkInternationalRelease(titleLower, torrentTitle);
    if (intlCheck.isInternational) {
      this.logger.debug('Rejeitado: Release internacional detectado', {
        titulo: torrentTitle.substring(0, 60),
        indicadores: intlCheck.indicators,
        motivo: intlCheck.reason
      });
      return false;
    }
    
    // 2. Verificação de grupos brasileiros
    const brCheck = this.checkBrazilianRelease(titleLower, torrentTitle);
    if (brCheck.isBrazilian) {
      this.logger.debug('Aceito: Release brasileiro detectado', {
        titulo: torrentTitle.substring(0, 60),
        indicadores: brCheck.indicators,
        motivo: brCheck.reason
      });
      return true;
    }
    
    // 3. Verifica dual áudio com português
    const hasPortugueseDualAudio = this.hasPortugueseDualAudio(titleLower);
    if (hasPortugueseDualAudio) {
      this.logger.debug('Aceito: Dual áudio com português', {
        titulo: torrentTitle.substring(0, 60)
      });
      return true;
    }
    
    // 4. Verifica inglês puro (deve rejeitar)
    const isEnglishOnly = this.isEnglishOnlyContent(titleLower);
    if (isEnglishOnly) {
      this.logger.debug('Rejeitado: Conteúdo apenas em inglês', {
        titulo: torrentTitle.substring(0, 60)
      });
      return false;
    }
    
    // 5. Verifica indicadores de português
    const hasPortugueseIndicators = this.hasPortugueseIndicators(titleLower);
    if (hasPortugueseIndicators) {
      this.logger.debug('Aceito: Indicadores de português', {
        titulo: torrentTitle.substring(0, 60)
      });
      return true;
    }
    
    // 6. Verifica padrões BR (séries, temporadas)
    const hasBRPatterns = this.hasBRPatterns(titleLower);
    if (hasBRPatterns) {
      this.logger.debug('Aceito: Padrão BR detectado', {
        titulo: torrentTitle.substring(0, 60)
      });
      return true;
    }
    
    // 7. Verifica palavras-chave relevantes
    const hasRelevantKeywords = this.hasRelevantKeywords(titleLower);
    if (hasRelevantKeywords) {
      this.logger.debug('Aceito: Palavras-chave relevantes', {
        titulo: torrentTitle.substring(0, 60)
      });
      return true;
    }
    
    // 8. Títulos curtos: benefício da dúvida
    const isShortTitle = this.isShortTitle(torrentTitle);
    if (isShortTitle) {
      this.logger.debug('Aceito: Título curto - benefício da dúvida', {
        titulo: torrentTitle.substring(0, 60)
      });
      return true;
    }
    
    // 9. Verificação final: padrão técnico internacional
    const isInternationalTechPattern = this.isInternationalTechnicalPattern(titleLower);
    if (isInternationalTechPattern) {
      this.logger.debug('Rejeitado: Padrão técnico internacional sem indicadores PT', {
        titulo: torrentTitle.substring(0, 60),
        motivo: 'Formato típico de release internacional sem áudio PT'
      });
      return false;
    }
    
    // 10. Rejeita por falta de indicadores claros
    this.logger.debug('Rejeitado: Sem indicadores claros de português', {
      titulo: torrentTitle.substring(0, 60),
      motivo: 'Nenhum indicador de português encontrado após análise completa'
    });
    return false;
  }

  // Verificação avançada de releases internacionais
  private checkInternationalRelease(titleLower: string, originalTitle: string): {
    isInternational: boolean;
    indicators: string[];
    reason: string;
  } {
    // Usa a função importada de technical-words
    const intlResult = containsInternationalIndicators(originalTitle);
    
    if (intlResult.isInternational) {
      return {
        isInternational: true,
        indicators: intlResult.indicators,
        reason: `Release internacional detectado: ${intlResult.reason}`
      };
    }
    
    // Verificação adicional: padrão internacional técnico
    const intlPatterns = [
      // Padrão: "título s01e07 720p webrip x264 grupo"
      /^\w+\s+\w+\s+s\d{2}e\d{2}\s+\d+p\s+\w+rip\s+x\d{3,4}\s+\w+$/i,
      // Padrão: "título.s01.e07.720p.webrip.x264-grupo"
      /^\w+\.\w+\.s\d{2}\.e\d{2}\.\d+p\.\w+rip\.x\d{3,4}-\w+$/i,
    ];
    
    for (const pattern of intlPatterns) {
      if (pattern.test(originalTitle)) {
        return {
          isInternational: true,
          indicators: ['padrao_internacional'],
          reason: 'Padrão de naming internacional detectado'
        };
      }
    }
    
    return {
      isInternational: false,
      indicators: [],
      reason: 'Não é release internacional'
    };
  }

  // Verificação de releases brasileiros
  private checkBrazilianRelease(titleLower: string, originalTitle: string): {
    isBrazilian: boolean;
    indicators: string[];
    reason: string;
  } {
    // Usa a função importada de technical-words
    const brResult = containsBrazilianIndicators(originalTitle);
    
    if (brResult.isBrazilian) {
      return brResult;
    }
    
    // Verificação adicional: grupos BR conhecidos
    for (const group of BRAZILIAN_RELEASE_GROUPS) {
      if (titleLower.includes(group)) {
        return {
          isBrazilian: true,
          indicators: [group],
          reason: `Grupo brasileiro conhecido: ${group}`
        };
      }
    }
    
    return {
      isBrazilian: false,
      indicators: [],
      reason: 'Não é release brasileiro'
    };
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
    
    for (const pattern of dualAudioPatterns) {
      if (titleLower.includes(pattern)) {
        return true;
      }
    }
    
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
    const hasStrongPortuguese = 
      (titleLower.includes('dublado') || titleLower.includes('legendado')) &&
      (titleLower.includes('português') || titleLower.includes('portugues') || titleLower.includes('pt'));
    
    if (hasStrongPortuguese) {
      return false;
    }
    
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
    
    const endsWithEnglish = titleLower.match(/\(eng\)$|\[eng\]$|\{eng\}$|\.eng$/) !== null;
    if (endsWithEnglish) {
      return true;
    }
    
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

  // Verifica padrão técnico internacional sem indicadores de PT
  private isInternationalTechnicalPattern(titleLower: string): boolean {
    // Conta palavras técnicas vs palavras de conteúdo
    const words = titleLower.split(/[\s\.\-_]+/).filter(w => w.length > 1);
    
    let technicalCount = 0;
    let contentWords = 0;
    
    for (const word of words) {
      if (isTechnicalWord(word)) {
        technicalCount++;
      } else if (word.length > 2 && !/^\d+p$/.test(word) && !/^[xs]\d+$/.test(word)) {
        contentWords++;
      }
    }
    
    // Se tem muitas palavras técnicas e poucas de conteúdo, é provavelmente internacional
    if (technicalCount > 3 && contentWords <= 2) {
      return true;
    }
    
    // Verifica padrão específico de release internacional
    const hasReleasePattern = 
      (titleLower.includes('720p') || titleLower.includes('1080p') || titleLower.includes('2160p')) &&
      (titleLower.includes('webrip') || titleLower.includes('web-dl') || titleLower.includes('bluray')) &&
      (titleLower.includes('x264') || titleLower.includes('x265') || titleLower.includes('h264')) &&
      !titleLower.includes('dublado') && 
      !titleLower.includes('legendado') &&
      !titleLower.includes('português') &&
      !titleLower.includes('portugues') &&
      !titleLower.includes('pt-br');
    
    return hasReleasePattern;
  }

  // Método auxiliar para análise detalhada
  analyzeTitle(torrentTitle: string): {
    isPortuguese: boolean;
    checks: Array<{name: string; passed: boolean; details?: string}>;
    indicators: {
      portuguese: string[];
      english: string[];
      international: string[];
      brazilian: string[];
    };
  } {
    const titleLower = torrentTitle.toLowerCase();
    const checks: Array<{name: string; passed: boolean; details?: string}> = [];
    const indicators = {
      portuguese: [] as string[],
      english: [] as string[],
      international: [] as string[],
      brazilian: [] as string[]
    };
    
    // Verifica indicadores de português
    for (const indicator of this.PORTUGUES_INDICATORS) {
      if (titleLower.includes(indicator)) {
        indicators.portuguese.push(indicator);
      }
    }
    
    // Verifica grupos internacionais
    for (const group of this.INTERNATIONAL_GROUPS) {
      if (titleLower.includes(group)) {
        indicators.international.push(group);
      }
    }
    
    // Verifica grupos brasileiros
    for (const group of BRAZILIAN_RELEASE_GROUPS) {
      if (titleLower.includes(group)) {
        indicators.brazilian.push(group);
      }
    }
    
    // Executa todas as verificações
    checks.push({
      name: 'Dual áudio português',
      passed: this.hasPortugueseDualAudio(titleLower),
      details: indicators.portuguese.length > 0 ? `Indicadores PT: ${indicators.portuguese.join(', ')}` : undefined
    });
    
    checks.push({
      name: 'Inglês puro',
      passed: this.isEnglishOnlyContent(titleLower),
      details: this.isEnglishOnlyContent(titleLower) ? 'Título marcado como apenas inglês' : undefined
    });
    
    checks.push({
      name: 'Indicadores portugueses',
      passed: indicators.portuguese.length > 0,
      details: indicators.portuguese.length > 0 ? `${indicators.portuguese.length} indicadores` : 'Nenhum'
    });
    
    checks.push({
      name: 'Padrões BR',
      passed: this.hasBRPatterns(titleLower)
    });
    
    checks.push({
      name: 'Release internacional',
      passed: indicators.international.length > 0,
      details: indicators.international.length > 0 ? `Grupos: ${indicators.international.join(', ')}` : undefined
    });
    
    checks.push({
      name: 'Release brasileiro',
      passed: indicators.brazilian.length > 0,
      details: indicators.brazilian.length > 0 ? `Grupos: ${indicators.brazilian.join(', ')}` : undefined
    });
    
    const isPortuguese = this.isPortugueseContent(torrentTitle);
    
    return {
      isPortuguese,
      checks,
      indicators
    };
  }

  // Métodos para extensão dinâmica

  addPortugueseIndicator(indicator: string): void {
    this.PORTUGUES_INDICATORS.push(indicator.toLowerCase());
    this.logger.debug('Indicador de português adicionado', { indicador: indicator });
  }

  addEnglishIndicator(indicator: string | RegExp): void {
    this.ENGLISH_ONLY_INDICATORS.push(indicator);
    this.logger.debug('Indicador de inglês adicionado', { 
      indicador: indicator instanceof RegExp ? indicator.toString() : indicator 
    });
  }

  addInternationalGroup(group: string): void {
    this.INTERNATIONAL_GROUPS.push(group.toLowerCase());
    this.logger.debug('Grupo internacional adicionado', { grupo: group });
  }

  addTechTag(tag: string): void {
    this.COMMON_TECH_TAGS.push(tag.toLowerCase());
    this.logger.debug('Tag técnica adicionada', { tag: tag });
  }

  addBRPattern(pattern: RegExp): void {
    this.BR_PATTERNS.push(pattern);
    this.logger.debug('Padrão BR adicionado', { padrao: pattern.toString() });
  }

  addKeywordCheck(keywords: string[], description: string): void {
    this.KEYWORD_CHECKS.push({ keywords, description });
    this.logger.debug('Palavras-chave adicionadas', { 
      descricao: description, 
      palavras_chave: keywords 
    });
  }

  // Estatísticas para debugging
  getIndicatorStats() {
    return {
      versao: this.VERSION,
      indicadores_portugues: this.PORTUGUES_INDICATORS.length,
      indicadores_ingles: this.ENGLISH_ONLY_INDICATORS.length,
      grupos_internacionais: this.INTERNATIONAL_GROUPS.length,
      tags_tecnicas: this.COMMON_TECH_TAGS.length,
      padroes_br: this.BR_PATTERNS.length,
      verificacoes_palavras_chave: this.KEYWORD_CHECKS.length,
      integracao_technical_words: 'ATIVA'
    };
  }

  // Log de configuração atual
  logCurrentConfig(): void {
    this.logger.info('Configuração atual LanguageDetector', this.getIndicatorStats());
    this.logger.debug('Detecção aprimorada com integração TechnicalWords');
  }
}