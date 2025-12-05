"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LanguageDetector = void 0;
const logger_1 = require("../../utils/logger");
class LanguageDetector {
    constructor() {
        this.VERSION = '2.2.0';
        this.PORTUGUES_INDICATORS = [
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
        this.ENGLISH_ONLY_INDICATORS = [
            '(eng)', '[eng]', '{eng}', '|eng|', '.eng.', '_eng_',
            'english', 'inglês', 'ingles',
            'english audio', 'inglês audio', 'ingles audio',
            'only eng', 'somente inglês', 'apenas inglês',
            'no portuguese', 'sem português', 'without portuguese',
            'eng only', 'english only',
            /\(eng[^)]*\)/i,
            /\[eng[^\]]*\]/i,
        ];
        this.INTERNATIONAL_GROUPS = [
            'yts', 'rarbg', 'ettv', 'eztv', 'skgtv', 'rartv', 'turbotorrent'
        ];
        this.COMMON_TECH_TAGS = [
            'webrip', 'web-dl', 'hdtv', 'bluray', 'x264', 'x265', 'h264', 'h265'
        ];
        this.BR_PATTERNS = [
            /\d+\s*ª?\s*temporada/i,
            /completa\s*\d+\s*temporada/i,
            /season\s*\d+\s*complete/i,
            /\d+\s*epis[oó]dios/i
        ];
        this.KEYWORD_CHECKS = [
            {
                keywords: ['horror story', 'historia de horror'],
                description: 'American Horror Story'
            },
            {
                keywords: ['breaking bad'],
                description: 'Breaking Bad'
            }
        ];
        this.logger = new logger_1.Logger('LanguageDetector');
        this.logger.info(`LanguageDetector v${this.VERSION} iniciado - Foco em detecção de idioma`);
    }
    isPortugueseContent(torrentTitle) {
        const titleLower = torrentTitle.toLowerCase();
        this.logger.debug('Analisando idioma', {
            title: torrentTitle.substring(0, 80)
        });
        const hasPortugueseDualAudio = this.hasPortugueseDualAudio(titleLower);
        if (hasPortugueseDualAudio) {
            this.logger.debug('Aceito: Dual áudio com português', {
                title: torrentTitle.substring(0, 60)
            });
            return true;
        }
        const isEnglishOnly = this.isEnglishOnlyContent(titleLower);
        if (isEnglishOnly) {
            this.logger.debug('Rejeitado: Conteúdo apenas em inglês', {
                title: torrentTitle.substring(0, 60)
            });
            return false;
        }
        const hasPortugueseIndicators = this.hasPortugueseIndicators(titleLower);
        if (hasPortugueseIndicators) {
            this.logger.debug('Aceito: Indicadores de português', {
                title: torrentTitle.substring(0, 60)
            });
            return true;
        }
        const hasBRPatterns = this.hasBRPatterns(titleLower);
        if (hasBRPatterns) {
            this.logger.debug('Aceito: Padrão BR detectado', {
                title: torrentTitle.substring(0, 60)
            });
            return true;
        }
        const hasRelevantKeywords = this.hasRelevantKeywords(titleLower);
        if (hasRelevantKeywords) {
            this.logger.debug('Aceito: Palavras-chave relevantes', {
                title: torrentTitle.substring(0, 60)
            });
            return true;
        }
        const isShortTitle = this.isShortTitle(torrentTitle);
        if (isShortTitle) {
            this.logger.debug('Aceito: Título curto - benefício da dúvida', {
                title: torrentTitle.substring(0, 60)
            });
            return true;
        }
        this.logger.debug('Rejeitado: Sem indicadores claros de português', {
            title: torrentTitle.substring(0, 60)
        });
        return false;
    }
    hasPortugueseDualAudio(titleLower) {
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
    isEnglishOnlyContent(titleLower) {
        const hasStrongPortuguese = (titleLower.includes('dublado') || titleLower.includes('legendado')) &&
            (titleLower.includes('português') || titleLower.includes('portugues') || titleLower.includes('pt'));
        if (hasStrongPortuguese) {
            return false;
        }
        const hasEnglishOnly = this.ENGLISH_ONLY_INDICATORS.some(indicator => {
            if (typeof indicator === 'string') {
                return titleLower.includes(indicator);
            }
            else if (indicator instanceof RegExp) {
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
        const hasInternationalGroup = this.INTERNATIONAL_GROUPS.some(group => titleLower.includes(group));
        const hasTechTags = this.COMMON_TECH_TAGS.some(tag => titleLower.includes(tag));
        return hasInternationalGroup && hasTechTags && !this.hasPortugueseIndicators(titleLower);
    }
    hasPortugueseIndicators(titleLower) {
        return this.PORTUGUES_INDICATORS.some(indicator => titleLower.includes(indicator));
    }
    hasBRPatterns(titleLower) {
        return this.BR_PATTERNS.some(pattern => pattern.test(titleLower));
    }
    hasRelevantKeywords(titleLower) {
        for (const check of this.KEYWORD_CHECKS) {
            if (check.keywords.some(keyword => titleLower.includes(keyword))) {
                return true;
            }
        }
        return false;
    }
    isShortTitle(torrentTitle) {
        const cleanTitle = torrentTitle
            .replace(/[^\w\s]|_/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const words = cleanTitle.split(' ').filter(w => w.length > 0);
        return words.length <= 5;
    }
    addPortugueseIndicator(indicator) {
        this.PORTUGUES_INDICATORS.push(indicator.toLowerCase());
        this.logger.debug('Indicador de português adicionado', { indicator });
    }
    addEnglishIndicator(indicator) {
        this.ENGLISH_ONLY_INDICATORS.push(indicator);
        this.logger.debug('Indicador de inglês adicionado', {
            indicator: indicator instanceof RegExp ? indicator.toString() : indicator
        });
    }
    addInternationalGroup(group) {
        this.INTERNATIONAL_GROUPS.push(group.toLowerCase());
        this.logger.debug('Grupo internacional adicionado', { group });
    }
    addTechTag(tag) {
        this.COMMON_TECH_TAGS.push(tag.toLowerCase());
        this.logger.debug('Tag técnica adicionada', { tag });
    }
    addBRPattern(pattern) {
        this.BR_PATTERNS.push(pattern);
        this.logger.debug('Padrão BR adicionado', { pattern: pattern.toString() });
    }
    addKeywordCheck(keywords, description) {
        this.KEYWORD_CHECKS.push({ keywords, description });
        this.logger.debug('Palavras-chave adicionadas', { description, keywords });
    }
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
    logCurrentConfig() {
        this.logger.info('Configuração atual LanguageDetector', this.getIndicatorStats());
    }
}
exports.LanguageDetector = LanguageDetector;
