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
        this.logger.info('LanguageDetector v2.1.0 iniciado (aceita mais títulos)');
    }
    isPortugueseContent(torrentTitle) {
        const titleLower = torrentTitle.toLowerCase();
        this.logger.debug('Verificando português', {
            title: torrentTitle.substring(0, 80)
        });
        if (this.isMovieTitle(titleLower)) {
            this.logger.debug('✅ ACEITO - Título de filme', {
                torrentTitle: torrentTitle.substring(0, 80),
                reason: 'Título contém "filme" ou é nome de filme'
            });
            return true;
        }
        const isDualAudio = this.isExplicitDualAudio(titleLower);
        if (isDualAudio) {
            this.logger.debug('✅ ACEITO - Dual áudio', {
                torrentTitle: torrentTitle.substring(0, 80),
                reason: 'Dual áudio detectado'
            });
            return true;
        }
        const hasEnglishOnly = this.hasEnglishOnlyIndicator(titleLower);
        if (hasEnglishOnly) {
            this.logger.debug('❌ REJEITADO - Inglês puro', {
                torrentTitle: torrentTitle.substring(0, 80),
                reason: 'Inglês puro detectado'
            });
            return false;
        }
        const hasPortuguese = this.hasPortugueseIndicator(titleLower);
        if (hasPortuguese) {
            this.logger.debug('✅ ACEITO - Português', {
                torrentTitle: torrentTitle.substring(0, 80),
                reason: 'Português detectado'
            });
            return true;
        }
        if (this.endsWithEnglishIndicator(titleLower)) {
            this.logger.debug('❌ REJEITADO - Termina com eng', {
                torrentTitle: torrentTitle.substring(0, 80),
                reason: 'Termina com indicador de inglês'
            });
            return false;
        }
        if (this.isInternationalEnglishOnly(titleLower)) {
            this.logger.debug('❌ REJEITADO - Grupo internacional', {
                torrentTitle: torrentTitle.substring(0, 80),
                reason: 'Grupo internacional sem português'
            });
            return false;
        }
        const hasBRPatterns = this.hasBRPatterns(titleLower);
        if (hasBRPatterns) {
            this.logger.debug('✅ ACEITO - Padrão BR', {
                torrentTitle: torrentTitle.substring(0, 80),
                reason: 'Padrão BR detectado'
            });
            return true;
        }
        const hasRelevantKeywords = this.hasRelevantKeywords(titleLower);
        if (hasRelevantKeywords) {
            this.logger.debug('✅ ACEITO - Palavras-chave', {
                torrentTitle: torrentTitle.substring(0, 80),
                reason: 'Palavras-chave relevantes'
            });
            return true;
        }
        if (this.isShortTitle(torrentTitle)) {
            this.logger.debug('✅ ACEITO - Título curto', {
                torrentTitle: torrentTitle.substring(0, 80),
                reason: 'Título curto - benefício da dúvida'
            });
            return true;
        }
        this.logger.debug('❌ REJEITADO - Sem indicadores', {
            torrentTitle: torrentTitle.substring(0, 80),
            reason: 'Sem indicadores claros de português'
        });
        return false;
    }
    isMovieTitle(titleLower) {
        if (titleLower.includes('filme') || titleLower.includes('movie')) {
            return true;
        }
        const brazilianMovies = [
            '',
            '',
            '',
            '',
            '',
            '',
            ''
        ];
        return brazilianMovies.some(movie => titleLower.includes(movie));
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
                if (combination === 'dual audio' || combination === 'dual áudio') {
                    const hasPortuguese = titleLower.includes('português') ||
                        titleLower.includes('portugues') ||
                        titleLower.includes('pt') ||
                        titleLower.includes('pt-br');
                    if (hasPortuguese) {
                        return true;
                    }
                }
                else {
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
