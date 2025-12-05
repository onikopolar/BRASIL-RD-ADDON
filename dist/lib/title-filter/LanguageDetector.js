"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LanguageDetector = void 0;
const logger_1 = require("../../utils/logger");
class LanguageDetector {
    constructor() {
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
        this.COMMON_ENGLISH_TAGS = [
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
                description: 'Título relevante para American Horror Story'
            },
            {
                keywords: ['breaking bad', 'breaking bad'],
                description: 'Título relevante para Breaking Bad'
            }
        ];
        this.logger = new logger_1.Logger('LanguageDetector');
    }
    isPortugueseContent(torrentTitle) {
        this.logger.debug('🔍 Verificando se conteúdo está em português', {
            title: torrentTitle.substring(0, 80)
        });
        const titleLower = torrentTitle.toLowerCase();
        const isDualAudio = this.isExplicitDualAudio(titleLower);
        if (isDualAudio) {
            this.logAcceptance('Dual áudio explícito detectado', torrentTitle);
            return true;
        }
        const hasEnglishOnly = this.hasEnglishOnlyIndicator(titleLower);
        if (hasEnglishOnly) {
            this.logRejection('Inglês puro detectado', torrentTitle);
            return false;
        }
        const hasPortuguese = this.hasPortugueseIndicator(titleLower);
        if (hasPortuguese) {
            this.logAcceptance('Português detectado', torrentTitle);
            return true;
        }
        if (this.endsWithEnglishIndicator(titleLower)) {
            this.logRejection('Termina com indicador de inglês', torrentTitle);
            return false;
        }
        if (this.isInternationalEnglishOnly(titleLower)) {
            this.logRejection('Grupo internacional sem português', torrentTitle);
            return false;
        }
        const hasBRPatterns = this.hasBRPatterns(titleLower);
        if (hasBRPatterns) {
            this.logAcceptance('Benefício da dúvida (padrão BR)', torrentTitle);
            return true;
        }
        const hasRelevantKeywords = this.hasRelevantKeywords(titleLower);
        if (hasRelevantKeywords) {
            this.logAcceptance('Benefício da dúvida (palavras-chave)', torrentTitle);
            return true;
        }
        this.logRejection('Título irrelevante', torrentTitle);
        return false;
    }
    isExplicitDualAudio(titleLower) {
        const dualAudioCombinations = [
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
            'pt-br e eng',
            'dual audio',
            'dual áudio'
        ];
        for (const combination of dualAudioCombinations) {
            if (titleLower.includes(combination)) {
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
                }
                else {
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
    hasEnglishOnlyIndicator(titleLower) {
        const hasStrongPortuguese = (titleLower.includes('dublado') || titleLower.includes('legendado')) &&
            (titleLower.includes('português') || titleLower.includes('portugues') || titleLower.includes('pt'));
        if (hasStrongPortuguese) {
            return false;
        }
        return this.ENGLISH_ONLY_INDICATORS.some(indicator => {
            if (typeof indicator === 'string') {
                return titleLower.includes(indicator);
            }
            else if (indicator instanceof RegExp) {
                return indicator.test(titleLower);
            }
            return false;
        });
    }
    hasPortugueseIndicator(titleLower) {
        return this.PORTUGUES_INDICATORS.some(indicator => titleLower.includes(indicator));
    }
    endsWithEnglishIndicator(titleLower) {
        return titleLower.match(/\(eng\)$|\[eng\]$|\{eng\}$|\.eng$/) !== null;
    }
    isInternationalEnglishOnly(titleLower) {
        const hasInternationalGroup = this.INTERNATIONAL_GROUPS.some(group => titleLower.includes(group));
        const hasEnglishTags = this.COMMON_ENGLISH_TAGS.some(tag => titleLower.includes(tag));
        return hasInternationalGroup && hasEnglishTags;
    }
    hasBRPatterns(titleLower) {
        return this.BR_PATTERNS.some(pattern => pattern.test(titleLower));
    }
    hasRelevantKeywords(titleLower) {
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
    logAcceptance(reason, torrentTitle) {
        this.logger.debug(`✅ ACEITO - ${reason}`, {
            torrentTitle: torrentTitle.substring(0, 80),
            reason: reason
        });
    }
    logRejection(reason, torrentTitle) {
        this.logger.debug(`❌ REJEITADO - ${reason}`, {
            torrentTitle: torrentTitle.substring(0, 80),
            reason: reason
        });
    }
    addPortugueseIndicator(indicator) {
        this.PORTUGUES_INDICATORS.push(indicator.toLowerCase());
    }
    addEnglishIndicator(indicator) {
        this.ENGLISH_ONLY_INDICATORS.push(indicator);
    }
    addInternationalGroup(group) {
        this.INTERNATIONAL_GROUPS.push(group.toLowerCase());
    }
    addEnglishTag(tag) {
        this.COMMON_ENGLISH_TAGS.push(tag.toLowerCase());
    }
    addBRPattern(pattern) {
        this.BR_PATTERNS.push(pattern);
    }
    addKeywordCheck(keywords, description) {
        this.KEYWORD_CHECKS.push({ keywords, description });
    }
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
exports.LanguageDetector = LanguageDetector;
