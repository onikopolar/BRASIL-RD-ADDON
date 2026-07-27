"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LanguageDetector = void 0;
const logger_js_1 = require("../../utils/logger.js");
const TechnicalWords_js_1 = require("../../lib/title-filter/TechnicalWords.js");
class LanguageDetector {
    static getInstance() {
        if (!LanguageDetector.instance) {
            LanguageDetector.instance = new LanguageDetector();
        }
        return LanguageDetector.instance;
    }
    constructor() {
        this.VERSION = '2.3.0';
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
            ...TechnicalWords_js_1.INTERNATIONAL_RELEASE_GROUPS,
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
        this.logger = new logger_js_1.Logger('LanguageDetector');
    }
    isPortugueseContent(torrentTitle) {
        const titleLower = torrentTitle.toLowerCase();
        const intlCheck = this.checkInternationalRelease(titleLower, torrentTitle);
        if (intlCheck.isInternational) {
            return false;
        }
        const brCheck = this.checkBrazilianRelease(titleLower, torrentTitle);
        if (brCheck.isBrazilian) {
            return true;
        }
        const hasPortugueseDualAudio = this.hasPortugueseDualAudio(titleLower);
        if (hasPortugueseDualAudio) {
            return true;
        }
        const isEnglishOnly = this.isEnglishOnlyContent(titleLower);
        if (isEnglishOnly) {
            return false;
        }
        const hasPortugueseIndicators = this.hasPortugueseIndicators(titleLower);
        if (hasPortugueseIndicators) {
            return true;
        }
        const hasBRPatterns = this.hasBRPatterns(titleLower);
        if (hasBRPatterns) {
            return true;
        }
        const hasRelevantKeywords = this.hasRelevantKeywords(titleLower);
        if (hasRelevantKeywords) {
            return true;
        }
        const isShortTitle = this.isShortTitle(torrentTitle);
        if (isShortTitle) {
            return true;
        }
        const isInternationalTechPattern = this.isInternationalTechnicalPattern(titleLower);
        if (isInternationalTechPattern) {
            return false;
        }
        return false;
    }
    checkWithTmdb(torrentTitle, ptTitle, enTitle) {
        if (!ptTitle || ptTitle === enTitle) {
            return { isPortuguese: true, reason: 'TMDB sem título PT distinto (benefício da dúvida)' };
        }
        const normalize = (s) => s.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ')
            .filter(w => w.length > 0);
        const torrentWords = normalize(torrentTitle);
        const ptWords = new Set(normalize(ptTitle));
        const enWords = new Set(normalize(enTitle));
        const PT_INDICATORS = new Set([
            'dublado', 'dublada', 'dublagem', 'dual', 'legendado', 'legendada',
            'legenda', 'nacional', 'pt', 'ptbr', 'pt-br', 'portugues', 'português',
            'brasileiro', 'brazilian', 'br', 'audio', 'áudio'
        ]);
        let foundPt = false;
        let foundEn = false;
        for (let i = 0; i < torrentWords.length; i++) {
            const word = torrentWords[i];
            if (ptWords.has(word)) {
                foundPt = true;
            }
            if (enWords.has(word) && !ptWords.has(word)) {
                foundEn = true;
            }
            if (PT_INDICATORS.has(word)) {
                foundPt = true;
            }
        }
        if (foundPt) {
            return { isPortuguese: true, reason: foundEn ? 'Indicadores PT presentes (com nome EN)' : 'Título PT do TMDB detectado' };
        }
        if (foundEn) {
            return { isPortuguese: false, reason: `Título em inglês sem indicadores PT: "${torrentTitle}"` };
        }
        return { isPortuguese: true, reason: 'Nenhuma palavra bateu TMDB (benefício da dúvida)' };
    }
    checkInternationalRelease(titleLower, originalTitle) {
        const intlResult = (0, TechnicalWords_js_1.containsInternationalIndicators)(originalTitle);
        if (intlResult.isInternational) {
            return {
                isInternational: true,
                indicators: intlResult.indicators,
                reason: `Release internacional detectado: ${intlResult.reason}`
            };
        }
        const intlPatterns = [
            /^\w+\s+\w+\s+s\d{2}e\d{2}\s+\d+p\s+\w+rip\s+x\d{3,4}\s+\w+$/i,
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
    checkBrazilianRelease(titleLower, originalTitle) {
        const brResult = (0, TechnicalWords_js_1.containsBrazilianIndicators)(originalTitle);
        if (brResult.isBrazilian) {
            return brResult;
        }
        for (const group of TechnicalWords_js_1.BRAZILIAN_RELEASE_GROUPS) {
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
    isInternationalTechnicalPattern(titleLower) {
        const words = titleLower.split(/[\s\.\-_]+/).filter(w => w.length > 1);
        let technicalCount = 0;
        let contentWords = 0;
        for (const word of words) {
            if ((0, TechnicalWords_js_1.isTechnicalWord)(word)) {
                technicalCount++;
            }
            else if (word.length > 2 && !/^\d+p$/.test(word) && !/^[xs]\d+$/.test(word)) {
                contentWords++;
            }
        }
        if (technicalCount > 3 && contentWords <= 2) {
            return true;
        }
        const hasReleasePattern = (titleLower.includes('720p') || titleLower.includes('1080p') || titleLower.includes('2160p')) &&
            (titleLower.includes('webrip') || titleLower.includes('web-dl') || titleLower.includes('bluray')) &&
            (titleLower.includes('x264') || titleLower.includes('x265') || titleLower.includes('h264')) &&
            !titleLower.includes('dublado') &&
            !titleLower.includes('legendado') &&
            !titleLower.includes('português') &&
            !titleLower.includes('portugues') &&
            !titleLower.includes('pt-br');
        return hasReleasePattern;
    }
    analyzeTitle(torrentTitle) {
        const titleLower = torrentTitle.toLowerCase();
        const checks = [];
        const indicators = {
            portuguese: [],
            english: [],
            international: [],
            brazilian: []
        };
        for (const indicator of this.PORTUGUES_INDICATORS) {
            if (titleLower.includes(indicator)) {
                indicators.portuguese.push(indicator);
            }
        }
        for (const group of this.INTERNATIONAL_GROUPS) {
            if (titleLower.includes(group)) {
                indicators.international.push(group);
            }
        }
        for (const group of TechnicalWords_js_1.BRAZILIAN_RELEASE_GROUPS) {
            if (titleLower.includes(group)) {
                indicators.brazilian.push(group);
            }
        }
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
    addPortugueseIndicator(indicator) {
        this.PORTUGUES_INDICATORS.push(indicator.toLowerCase());
        this.logger.debug('Indicador de português adicionado', { indicador: indicator });
    }
    addEnglishIndicator(indicator) {
        this.ENGLISH_ONLY_INDICATORS.push(indicator);
        this.logger.debug('Indicador de inglês adicionado', {
            indicador: indicator instanceof RegExp ? indicator.toString() : indicator
        });
    }
    addInternationalGroup(group) {
        this.INTERNATIONAL_GROUPS.push(group.toLowerCase());
        this.logger.debug('Grupo internacional adicionado', { grupo: group });
    }
    addTechTag(tag) {
        this.COMMON_TECH_TAGS.push(tag.toLowerCase());
        this.logger.debug('Tag técnica adicionada', { tag: tag });
    }
    addBRPattern(pattern) {
        this.BR_PATTERNS.push(pattern);
        this.logger.debug('Padrão BR adicionado', { padrao: pattern.toString() });
    }
    addKeywordCheck(keywords, description) {
        this.KEYWORD_CHECKS.push({ keywords, description });
        this.logger.debug('Palavras-chave adicionadas', {
            descricao: description,
            palavras_chave: keywords
        });
    }
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
    logCurrentConfig() {
        this.logger.info('Configuração atual LanguageDetector', this.getIndicatorStats());
        this.logger.debug('Detecção aprimorada com integração TechnicalWords');
    }
}
exports.LanguageDetector = LanguageDetector;
