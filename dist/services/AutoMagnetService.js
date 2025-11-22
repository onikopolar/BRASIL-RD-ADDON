import { getTorrent, createTorrent, createFile } from '../database/repository';
import { RealDebridService } from './RealDebridService';
import { ImdbScraperService } from './ImdbScraperService';
import { Logger } from '../utils/logger';
const logger = new Logger('AutoMagnetService');
const rdService = new RealDebridService();
const imdbScraper = new ImdbScraperService();
export class AutoMagnetService {
    constructor() {
        this.videoExtensions = [
            '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v',
            '.mpg', '.mpeg', '.3gp', '.ts', '.mts', '.m2ts', '.vob'
        ];
        this.promotionalKeywords = [
            'promo', '1xbet', 'bet', 'propaganda', 'publicidade', 'advertisement',
            'sample', 'trailer', 'teaser', 'preview', 'torrentdosfilmes'
        ];
        this.episodePatterns = [
            /(\d+)x(\d+)/i,
            /s(\d+)e(\d+)/i,
            /season[\s\._-]?(\d+)[\s\._-]?episode[\s\._-]?(\d+)/i,
            /ep[\s\._-]?(\d+)/i,
            /(\d+)(?:\s*-\s*|\s*)(\d+)/,
            /^(\d+)$/
        ];
        this.supportedLanguages = [
            'pt-BR', 'pt', 'en', 'en-US', 'es', 'fr', 'de', 'it', 'ja', 'ja-JP',
            'ko', 'zh', 'zh-CN', 'zh-TW', 'ru', 'ar', 'hi', 'multi', 'dual'
        ];
        logger.info('AutoMagnetService inicializado - Modo Automático');
    }
    async autoAddMagnet(magnetLink, title, imdbId, type, seeds = 50, quality, size) {
        try {
            logger.info('Processando magnet automaticamente', {
                title,
                imdbId,
                type,
                magnetLink: magnetLink.substring(0, 100) + '...'
            });
            if (!this.validateMagnetLink(magnetLink)) {
                return {
                    success: false,
                    magnetAdded: false,
                    message: 'Link magnet inválido'
                };
            }
            const category = type === 'series' ? 'serie' : 'filme';
            const language = this.detectLanguage(title);
            const finalQuality = quality || this.extractQualityFromTitle(title);
            const magnetData = {
                imdbId: imdbId || await this.searchImdbId(title),
                title: title,
                magnet: magnetLink,
                quality: finalQuality,
                seeds: seeds,
                size: size,
                category: category,
                language: language,
                addedAt: new Date().toISOString()
            };
            await this.addToDatabase(magnetData);
            logger.info('Magnet adicionado automaticamente ao catálogo', {
                title: magnetData.title,
                imdbId: magnetData.imdbId,
                quality: magnetData.quality,
                seeds: magnetData.seeds,
                category: magnetData.category
            });
            return {
                success: true,
                magnetAdded: true,
                magnetData: magnetData
            };
        }
        catch (error) {
            logger.error('Erro ao adicionar magnet automaticamente', {
                title,
                imdbId,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return {
                success: false,
                magnetAdded: false,
                message: `Erro: ${error instanceof Error ? error.message : 'Erro desconhecido'}`
            };
        }
    }
    extractQualityFromTitle(title) {
        const qualityMatch = title.match(/(4K|2160p|1080p|720p|480p|SD)/i);
        if (qualityMatch) {
            const matchedQuality = qualityMatch[1].toLowerCase();
            return matchedQuality === '2160p' ? '4K' : matchedQuality;
        }
        return '1080p';
    }
    validateMagnetLink(magnet) {
        const isValid = magnet.startsWith('magnet:') &&
            magnet.includes('xt=urn:btih:') &&
            magnet.length > 50;
        if (!isValid) {
            logger.warn('Link magnet inválido fornecido', {
                magnetLength: magnet.length,
                hasMagnetPrefix: magnet.startsWith('magnet:'),
                hasBtih: magnet.includes('xt=urn:btih:')
            });
        }
        return isValid;
    }
    async searchImdbId(title) {
        try {
            const cleanTitle = this.cleanTitleForSearch(title);
            logger.debug('Buscando ID IMDB automaticamente', { title: cleanTitle });
            const knownTitles = {
                'carros': 'tt0317219',
                'shrek': 'tt0126029',
                'monstros sa': 'tt0198781',
                'procurando nemo': 'tt0266543',
                'toystory': 'tt0114709',
                'toy story': 'tt0114709',
                'rei leão': 'tt0110357',
                'frozen': 'tt2294629',
                'incrível mundo gumball': 'tt1942683',
                'trem bala': 'tt12593682',
                'bullet train': 'tt12593682',
                'breaking bad': 'tt0903747',
                'stranger things': 'tt4574334'
            };
            const lowerTitle = cleanTitle.toLowerCase();
            for (const [key, imdbId] of Object.entries(knownTitles)) {
                if (lowerTitle.includes(key)) {
                    logger.debug('ID IMDB detectado automaticamente', { title: key, imdbId });
                    return imdbId;
                }
            }
            return `auto-${Date.now()}`;
        }
        catch (error) {
            logger.error('Erro ao buscar ID IMDB', {
                title,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return `auto-error-${Date.now()}`;
        }
    }
    cleanTitleForSearch(title) {
        return title
            .replace(/\d{4}/, '')
            .replace(/OPEN MATTE IMAX|WEB-DL|H264|AC3|DUAL|1080p|720p|4K|COMPLETA|TEMPORADA|SEASON/gi, '')
            .replace(/[._+-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
    detectLanguage(title) {
        const lowerTitle = title.toLowerCase();
        if (lowerTitle.includes('dual'))
            return 'pt-BR,en';
        if (lowerTitle.includes('dublado'))
            return 'pt-BR';
        if (lowerTitle.includes('legendado'))
            return 'pt';
        if (lowerTitle.includes('english') || lowerTitle.includes('eng'))
            return 'en';
        return 'pt-BR';
    }
    async addToDatabase(magnetData) {
        try {
            const magnetHash = this.extractHashFromMagnet(magnetData.magnet);
            if (!magnetHash) {
                throw new Error('Não foi possível extrair infoHash do magnet');
            }
            const existingTorrent = await getTorrent(magnetHash);
            if (existingTorrent) {
                logger.debug('Magnet já existe no banco de dados, ignorando', {
                    title: magnetData.title,
                    imdbId: magnetData.imdbId
                });
                return;
            }
            await createTorrent({
                infoHash: magnetHash,
                provider: 'brasil-rd',
                title: magnetData.title,
                size: 0,
                type: magnetData.category === 'serie' ? 'series' : 'movie',
                uploadDate: new Date(),
                seeders: magnetData.seeds || 0,
                languages: magnetData.language,
                resolution: magnetData.quality
            });
            await createFile({
                infoHash: magnetHash,
                title: magnetData.title,
                imdbId: magnetData.imdbId,
                size: 0
            });
            logger.info('Magnet adicionado ao banco de dados automaticamente', {
                title: magnetData.title,
                imdbId: magnetData.imdbId,
                quality: magnetData.quality,
                language: magnetData.language,
                category: magnetData.category,
                infoHash: magnetHash
            });
        }
        catch (error) {
            logger.error('Erro ao salvar magnet no banco de dados', {
                error: error instanceof Error ? error.message : 'Erro desconhecido',
                title: magnetData.title
            });
            throw error;
        }
    }
    extractHashFromMagnet(magnet) {
        const match = magnet.match(/btih:([a-zA-Z0-9]+)/i);
        return match ? match[1].toLowerCase() : null;
    }
    async processRealDebridOnClick(magnetData, apiKey) {
        try {
            logger.info('Processando Real-Debrid no click do usuário', {
                title: magnetData.title,
                imdbId: magnetData.imdbId
            });
            const existingTorrent = await this.checkExistingTorrent(magnetData.magnet, apiKey);
            if (existingTorrent.found && existingTorrent.downloaded) {
                logger.info('Torrent já baixado no Real-Debrid', {
                    title: magnetData.title,
                    torrentId: existingTorrent.torrentId
                });
                const streamLink = await rdService.getStreamLinkForTorrent(existingTorrent.torrentId, apiKey);
                return {
                    success: true,
                    streamLink: streamLink || undefined,
                    status: 'ready'
                };
            }
            if (existingTorrent.found && !existingTorrent.downloaded) {
                logger.info('Torrent encontrado mas ainda não baixado', {
                    title: magnetData.title,
                    torrentId: existingTorrent.torrentId,
                    status: existingTorrent.status
                });
                return {
                    success: true,
                    status: 'downloading',
                    message: `Download em progresso: ${existingTorrent.status}`
                };
            }
            logger.info('Adicionando torrent ao Real-Debrid', { title: magnetData.title });
            const torrentId = await rdService.addMagnet(magnetData.magnet, apiKey);
            await rdService.selectFiles(torrentId, apiKey, 'all');
            const torrentInfo = await rdService.getTorrentInfo(torrentId, apiKey);
            return {
                success: true,
                status: torrentInfo.status,
                message: `Torrent adicionado: ${torrentInfo.status}`
            };
        }
        catch (error) {
            logger.error('Erro ao processar Real-Debrid no click', {
                title: magnetData.title,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return {
                success: false,
                status: 'error',
                message: `Erro no Real-Debrid: ${error instanceof Error ? error.message : 'Erro desconhecido'}`
            };
        }
    }
    async checkExistingTorrent(magnet, apiKey) {
        try {
            const magnetHash = this.extractMagnetHash(magnet);
            if (!magnetHash) {
                logger.warn('Não foi possível extrair hash do magnet', {
                    magnet: magnet.substring(0, 100) + '...'
                });
                return { found: false, downloaded: false };
            }
            logger.debug('Buscando torrent existente no Real-Debrid', {
                magnetHash,
                magnetLength: magnet.length
            });
            const existingTorrent = await rdService.findExistingTorrent(magnetHash, apiKey);
            if (existingTorrent) {
                logger.info('Torrent encontrado no Real-Debrid', {
                    torrentId: existingTorrent.id,
                    magnetHash,
                    status: existingTorrent.status,
                    progress: existingTorrent.progress,
                    downloaded: existingTorrent.status === 'downloaded'
                });
                return {
                    found: true,
                    torrentId: existingTorrent.id,
                    status: existingTorrent.status,
                    downloaded: existingTorrent.status === 'downloaded'
                };
            }
            logger.debug('Torrent não encontrado no Real-Debrid', {
                magnetHash,
                searchedInUserTorrents: true
            });
            return { found: false, downloaded: false };
        }
        catch (error) {
            logger.warn('Erro ao verificar torrent existente no Real-Debrid', {
                error: error instanceof Error ? error.message : 'Erro desconhecido',
                magnet: magnet.substring(0, 100) + '...'
            });
            return { found: false, downloaded: false };
        }
    }
    extractMagnetHash(magnet) {
        const match = magnet.match(/btih:([^&]+)/i);
        return match ? match[1] : '';
    }
}
export default AutoMagnetService;
