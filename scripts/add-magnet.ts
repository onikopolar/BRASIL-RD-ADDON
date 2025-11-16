#!/usr/bin/env ts-node

import * as dotenv from 'dotenv';
dotenv.config();

import { RealDebridService } from '../src/services/RealDebridService';
import { ImdbScraperService } from '../src/services/ImdbScraperService';
import { Logger } from '../src/utils/logger';
import * as readline from 'readline';
import * as fs from 'fs-extra';
import * as path from 'path';

const logger = new Logger('MagnetAdder');
const rdService = new RealDebridService();
const imdbScraper = new ImdbScraperService();

interface MagnetData {
  imdbId: string;
  title: string;
  magnet: string;
  quality: string;
  seeds: number;
  category: string;
  language: string;
  addedAt: string;
}

interface ProcessResult {
  success: boolean;
  downloadLink?: string;
  message?: string;
  downloadTime?: number;
  torrentId?: string;
  mainFile?: string;
  selectedFiles?: number;
}

interface DownloadWaitResult {
  success: boolean;
  downloadLink?: string;
  message?: string;
}

interface EpisodeInfo {
  season: number;
  episode: number;
  rawMatch: string;
}

interface RDFile {
  id: number;
  path: string;
  bytes: number;
  selected: number;
}

class MagnetAdder {
  private rl: readline.Interface;
  private readonly downloadCheckDelay = 5000;
  private readonly maxDownloadTime = 30 * 60 * 1000;

  private readonly videoExtensions = [
    '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v',
    '.mpg', '.mpeg', '.3gp', '.ts', '.mts', '.m2ts', '.vob'
  ];

  private readonly errorStatuses = ['magnet_error', 'virus', 'dead', 'error'];

  private readonly episodePatterns: RegExp[] = [
    /(\d+)x(\d+)/i,
    /s(\d+)e(\d+)/i,
    /season[\s\._-]?(\d+)[\s\._-]?episode[\s\._-]?(\d+)/i,
    /ep[\s\._-]?(\d+)/i,
    /(\d+)(?:\s*-\s*|\s*)(\d+)/,
    /^(\d+)$/
  ];

  private readonly supportedLanguages = [
    'pt-BR', 'pt', 'en', 'en-US', 'es', 'fr', 'de', 'it', 'ja', 'ja-JP',
    'ko', 'zh', 'zh-CN', 'zh-TW', 'ru', 'ar', 'hi', 'multi', 'dual'
  ];

  private readonly promotionalKeywords = [
    'promo', '1xbet', 'bet', 'propaganda', 'publicidade', 'advertisement',
    'sample', 'trailer', 'teaser', 'preview', 'torrentdosfilmes'
  ];

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  private question(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(prompt, resolve);
    });
  }

  private extractMagnetInfo(magnet: string): { title: string; quality: string } {
    let title = 'Título Desconhecido';
    let quality = '1080p';

    try {
      const nameMatch = magnet.match(/dn=([^&]+)/);
      if (nameMatch && nameMatch[1]) {
        title = decodeURIComponent(nameMatch[1])
          .replace(/[._+]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      }

      const qualityMatch = title.match(/(4K|2160p|1080p|720p|480p|SD)/i);
      if (qualityMatch) {
        const matchedQuality = qualityMatch[1].toLowerCase();
        quality = matchedQuality === '2160p' ? '4K' : matchedQuality;
      }
    } catch (error) {
      logger.warn('Erro ao extrair informações do magnet', {
        error: error instanceof Error ? error.message : 'Erro desconhecido',
        magnet: magnet.substring(0, 100)
      });
    }

    return { title, quality };
  }

  private validateMagnetLink(magnet: string): boolean {
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

  private async validateAndParseSeeds(seedsInput: string): Promise<number> {
    const defaultSeeds = 50;

    if (!seedsInput.trim()) {
      return defaultSeeds;
    }

    const parsedSeeds = parseInt(seedsInput, 10);

    if (isNaN(parsedSeeds) || parsedSeeds < 0) {
      console.log('Valor de sementes inválido. Usando padrão:', defaultSeeds);
      return defaultSeeds;
    }

    return parsedSeeds;
  }

  private async searchImdbId(title: string): Promise<string | null> {
    try {
      const cleanTitle = this.cleanTitleForSearch(title);
      console.log('Buscando ID IMDB para:', cleanTitle);

      // Primeiro tenta usar o ImdbScraperService para buscar por título
      const scrapedTitle = await this.searchTitleWithScraper(cleanTitle);
      if (scrapedTitle) {
        console.log('Título encontrado via scraper:', scrapedTitle);
        // Aqui você poderia implementar uma busca reversa do IMDB ID pelo título
        // Por enquanto, vamos manter a lista conhecida como fallback
      }

      // Fallback para lista conhecida
      const knownTitles: Record<string, string> = {
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
          console.log('ID IMDB detectado automaticamente:', imdbId);
          return imdbId;
        }
      }

      console.log('ID IMDB não encontrado automaticamente');
      return null;
    } catch (error) {
      logger.error('Erro ao buscar ID IMDB', {
        title,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
      return null;
    }
  }

  private cleanTitleForSearch(title: string): string {
    return title
      .replace(/\d{4}/, '')
      .replace(/OPEN MATTE IMAX|WEB-DL|H264|AC3|DUAL|1080p|720p|4K|COMPLETA|TEMPORADA|SEASON/gi, '')
      .replace(/[._+-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async searchTitleWithScraper(title: string): Promise<string | null> {
    // Esta função pode ser expandida para usar o TorrentScraperService
    // para buscar informações mais precisas sobre o título
    return null;
  }

  private filterPromotionalFiles(files: RDFile[]): RDFile[] {
    return files.filter(file => {
      const filename = file.path.toLowerCase();
      const isPromotional = this.promotionalKeywords.some(keyword => filename.includes(keyword));
      
      if (isPromotional) {
        console.log('   Arquivo promocional filtrado:', file.path);
      }
      
      return !isPromotional;
    });
  }

  private identifyMainFile(files: RDFile[]): RDFile | null {
    const filteredFiles = this.filterPromotionalFiles(files);

    if (filteredFiles.length === 0) {
      return null;
    }

    const sortedFiles = filteredFiles.sort((a, b) => b.bytes - a.bytes);
    return sortedFiles[0];
  }

  private identifyVideoFilesForCategory(files: RDFile[], category: string): RDFile[] {
    const videoFiles = files.filter(file =>
      this.videoExtensions.some(ext => file.path.toLowerCase().endsWith(ext))
    );

    const cleanFiles = this.filterPromotionalFiles(videoFiles);

    if (category === 'serie') {
      // Para séries, retornar TODOS os arquivos de vídeo (não apenas o maior)
      console.log('   Série detectada - selecionando TODOS os arquivos de vídeo');
      return this.sortFilesByEpisode(cleanFiles);
    } else {
      // Para filmes, manter comportamento original (apenas o maior arquivo)
      const mainFile = this.identifyMainFile(cleanFiles);
      return mainFile ? [mainFile] : [];
    }
  }

  private isPromotionalFile(filename: string): boolean {
    const lowerFilename = filename.toLowerCase();
    return this.promotionalKeywords.some(keyword => lowerFilename.includes(keyword));
  }

  async start(): Promise<void> {
    try {
      this.displayHeader();

      const magnetLink = await this.question('Digite o link magnet: ');

      if (!this.validateMagnetLink(magnetLink)) {
        console.log('ERRO: Link magnet inválido ou malformado');
        this.cleanup();
        return;
      }

      const magnetInfo = await this.processMagnetInfo(magnetLink);
      if (!magnetInfo) return;

      const userInput = await this.collectUserInput(magnetInfo.title);
      const magnetData = this.createMagnetData(magnetInfo, userInput, magnetLink);

      const result = await this.processWithRealDebrid(magnetData);
      this.displayResult(result);

    } catch (error) {
      this.handleError('Falha ao processar magnet', error);
    } finally {
      this.cleanup();
    }
  }

  private displayHeader(): void {
    console.log('BRASIL RD - ADICIONAR LINK MAGNET');
    console.log('==================================\n');
  }

  private async processMagnetInfo(magnetLink: string): Promise<{ title: string; quality: string } | null> {
    console.log('Analisando link magnet...');

    const info = this.extractMagnetInfo(magnetLink);
    console.log('Título detectado:', info.title);
    console.log('Qualidade:', info.quality);

    return info;
  }

  private async collectUserInput(title: string): Promise<{
    imdbId: string;
    category: string;
    language: string;
    seeds: number;
  }> {
    const autoImdbId = await this.searchImdbId(title);

    let imdbId: string;
    if (autoImdbId) {
      imdbId = autoImdbId;
      console.log('ID IMDB detectado automaticamente:', imdbId);
    } else {
      const userImdbId = await this.question('ID IMDB (ex: tt1234567) ou Enter para pular: ');
      imdbId = userImdbId.trim();

      if (!imdbId) {
        console.log('Nenhum ID IMDB fornecido. Este magnet precisará de IMDB manual posteriormente.');
      }
    }

    let category: string;
    while (true) {
      const categoryInput = await this.question('Categoria (filme/serie): ');
      category = categoryInput.trim().toLowerCase();
      if (category === 'filme' || category === 'serie') break;
      console.log('Categoria inválida. Use "filme" ou "serie".');
    }

    console.log('\nIdiomas suportados:', this.supportedLanguages.join(', '));
    console.log('Exemplos: pt-BR, en, ja-JP, multi, dual');
    console.log('Para múltiplos idiomas, separe por vírgula: pt-BR,en,ja-JP');
    
    let language: string;
    while (true) {
      const languageInput = await this.question('Idioma(s) (digite o código): ');
      const inputLanguages = languageInput.trim();
      
      if (!inputLanguages) {
        language = 'pt-BR';
        console.log('Usando idioma padrão: pt-BR');
        break;
      }

      const languagesArray = inputLanguages.split(',').map(lang => lang.trim());
      const allSupported = languagesArray.every(lang => this.supportedLanguages.includes(lang));
      
      if (allSupported && languagesArray.length > 0) {
        language = languagesArray.join(',');
        break;
      }
      
      console.log('Um ou mais idiomas não são suportados. Use apenas idiomas da lista.');
      console.log('Ou pressione Enter para usar pt-BR como padrão.');
    }

    const seedsInput = await this.question('Número de sementes (padrão: 50): ');
    const seeds = await this.validateAndParseSeeds(seedsInput);

    return { imdbId, category, language, seeds };
  }

  private createMagnetData(
    magnetInfo: { title: string; quality: string },
    userInput: { imdbId: string; category: string; language: string; seeds: number },
    magnetLink: string
  ): MagnetData {
    return {
      imdbId: userInput.imdbId,
      title: magnetInfo.title,
      magnet: magnetLink,
      quality: magnetInfo.quality,
      seeds: userInput.seeds,
      category: userInput.category,
      language: userInput.language,
      addedAt: new Date().toISOString()
    };
  }

  private async processWithRealDebrid(magnetData: MagnetData): Promise<ProcessResult> {
    const startTime = Date.now();
    let torrentId: string | null = null;

    try {
      console.log('\nProcessando com Real-Debrid...');

      torrentId = await this.addMagnetToRealDebrid(magnetData.magnet);
      const videoFiles = await this.analyzeTorrentFiles(torrentId, magnetData.category);

      if (videoFiles.length === 0) {
        await this.addToJSON(magnetData);
        return this.createFailureResult('Nenhum arquivo de vídeo detectado no torrent');
      }

      console.log(`Encontrados ${videoFiles.length} arquivos de vídeo válidos`);
      
      await this.selectVideoFiles(torrentId, videoFiles);
      const downloadResult = await this.waitForDownload(torrentId, magnetData.title);
      
      if (!downloadResult.success) {
        await this.addToJSON(magnetData);
        return this.createFailureResult(downloadResult.message || 'Download não concluído com sucesso');
      }

      await this.addToJSON(magnetData);

      const downloadTime = Math.round((Date.now() - startTime) / 1000);

      return {
        success: true,
        downloadLink: downloadResult.downloadLink,
        downloadTime,
        torrentId,
        mainFile: magnetData.category === 'serie' ? 'Múltiplos episódios' : videoFiles[0]?.path,
        selectedFiles: videoFiles.length
      };

    } catch (error) {
      logger.error('Erro no processamento do Real-Debrid', {
        torrentId,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });

      if (torrentId) {
        await this.addToJSON(magnetData);
      }

      return this.createFailureResult(
        `Erro de processamento: ${error instanceof Error ? error.message : 'Erro desconhecido'}`
      );
    }
  }

  private async addMagnetToRealDebrid(magnetLink: string): Promise<string> {
    console.log('1. Adicionando magnet ao Real-Debrid...');
    const torrentId = await rdService.addMagnet(magnetLink);
    console.log('ID do Torrent:', torrentId);
    return torrentId;
  }

  private async analyzeTorrentFiles(torrentId: string, category: string): Promise<RDFile[]> {
    console.log('2. Analisando arquivos do torrent...');
    const torrentInfo = await rdService.getTorrentInfo(torrentId);
    const files = torrentInfo.files || [];

    const videoFiles = this.identifyVideoFilesForCategory(files, category);

    if (videoFiles.length === 0) {
      console.log('AVISO: Nenhum arquivo de vídeo válido encontrado');
      this.displayAvailableFiles(files);
      return [];
    }

    console.log(`Encontrados ${videoFiles.length} arquivos de vídeo:`);
    videoFiles.forEach((file: RDFile, index: number) => {
      const sizeMB = (file.bytes / 1024 / 1024).toFixed(2);
      const isPromo = this.isPromotionalFile(file.path) ? ' [PROMO]' : '';
      console.log(`   ${(index + 1).toString().padStart(2, ' ')}. ${file.path} (${sizeMB} MB)${isPromo}`);
    });

    return videoFiles;
  }

  private sortFilesByEpisode(files: RDFile[]): RDFile[] {
    const filesWithEpisodeInfo = files.map(file => ({
      file,
      episodeInfo: this.extractEpisodeInfo(file.path)
    }));

    return filesWithEpisodeInfo
      .sort((a, b) => this.compareEpisodeInfo(a.episodeInfo, b.episodeInfo))
      .map(item => item.file);
  }

  private extractEpisodeInfo(filename: string): EpisodeInfo {
    for (const pattern of this.episodePatterns) {
      const match = filename.match(pattern);
      if (match) {
        let season = 1;
        let episode = 0;

        if (pattern.source.includes('x') || pattern.source.includes('s\\d+e')) {
          season = parseInt(match[1]);
          episode = parseInt(match[2]);
        } else if (pattern.source.includes('ep')) {
          episode = parseInt(match[1]);
        } else if (pattern.source === '^(\\d+)$') {
          episode = parseInt(match[1]);
        } else if (match.length >= 3) {
          season = parseInt(match[1]);
          episode = parseInt(match[2]);
        }

        if (!isNaN(season) && !isNaN(episode)) {
          return {
            season,
            episode,
            rawMatch: match[0]
          };
        }
      }
    }

    const fallbackMatch = filename.match(/\d+/);
    const fallbackNumber = fallbackMatch ? parseInt(fallbackMatch[0]) : 0;
    
    return {
      season: 1,
      episode: fallbackNumber,
      rawMatch: fallbackMatch ? fallbackMatch[0] : 'unknown'
    };
  }

  private compareEpisodeInfo(a: EpisodeInfo, b: EpisodeInfo): number {
    if (a.season !== b.season) {
      return a.season - b.season;
    }
    
    if (a.episode !== b.episode) {
      return a.episode - b.episode;
    }
    
    return 0;
  }

  private displayAvailableFiles(files: RDFile[]): void {
    console.log('   Arquivos disponíveis:');
    files.slice(0, 10).forEach((file: RDFile, index: number) => {
      const sizeMB = (file.bytes / 1024 / 1024).toFixed(2);
      const isVideo = this.videoExtensions.some(ext => file.path.toLowerCase().endsWith(ext));
      const videoTag = isVideo ? ' [VIDEO]' : '';
      console.log(`   ${(index + 1).toString().padStart(2, ' ')}. ${file.path} (${sizeMB} MB)${videoTag}`);
    });

    if (files.length > 10) {
      console.log('   ... e mais', files.length - 10, 'arquivos');
    }
  }

  private async selectVideoFiles(torrentId: string, videoFiles: RDFile[]): Promise<void> {
    console.log('3. Selecionando arquivos de vídeo...');
    
    if (videoFiles.length === 0) {
      throw new Error('Nenhum arquivo de vídeo válido para selecionar');
    }

    const videoFileIds = videoFiles.map(file => file.id.toString()).join(',');
    await rdService.selectFiles(torrentId, videoFileIds);
    
    console.log(`${videoFiles.length} arquivos selecionados:`);
    videoFiles.forEach((file, index) => {
      console.log(`      ${index + 1}. ${file.path}`);
    });
  }

  private async waitForDownload(torrentId: string, title: string): Promise<DownloadWaitResult> {
    console.log('4. Aguardando download...');
    console.log('   Status: Aguardando início do download...');

    const startTime = Date.now();
    let lastProgress = -1;
    let lastStatus = '';

    while (Date.now() - startTime < this.maxDownloadTime) {
      try {
        const torrentInfo = await rdService.getTorrentInfo(torrentId);
        const currentProgress = Math.floor(torrentInfo.progress);
        const currentStatus = torrentInfo.status;

        if (currentStatus !== lastStatus || currentProgress !== lastProgress) {
          const elapsedTime = Math.round((Date.now() - startTime) / 1000);
          const minutes = Math.floor(elapsedTime / 60);
          const seconds = elapsedTime % 60;
          console.log(`   Progresso: ${currentProgress}% | Tempo: ${minutes}m${seconds}s | Status: ${currentStatus}`);
          lastProgress = currentProgress;
          lastStatus = currentStatus;
        }

        if (torrentInfo.status === 'downloaded') {
          const totalTime = Math.round((Date.now() - startTime) / 1000);
          const totalMinutes = Math.floor(totalTime / 60);
          const totalSeconds = totalTime % 60;
          console.log(`Download concluído! Tempo total: ${totalMinutes}m${totalSeconds}s`);
          return await this.handleDownloadCompletion(torrentId);
        }

        if (this.errorStatuses.includes(torrentInfo.status)) {
          return this.createDownloadFailure(`Download falhou. Status: ${torrentInfo.status}`);
        }

        await this.delay(this.downloadCheckDelay);

      } catch (error) {
        logger.error('Erro na verificação do download', {
          torrentId,
          error: error instanceof Error ? error.message : 'Erro desconhecido'
        });

        await this.delay(this.downloadCheckDelay);
      }
    }

    return this.createDownloadFailure(
      `Tempo máximo de espera excedido (${this.maxDownloadTime / 60000} minutos). Download pode continuar em segundo plano.`
    );
  }

  private async handleDownloadCompletion(torrentId: string): Promise<DownloadWaitResult> {
    try {
      const downloadLink = await rdService.getExistingStreamLink(torrentId);
      
      if (!downloadLink) {
        return this.createDownloadFailure('Não foi possível obter o link de download após conclusão');
      }

      return { success: true, downloadLink };
    } catch (error) {
      logger.error('Erro ao obter link de download após conclusão', {
        torrentId,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });

      return this.createDownloadFailure(
        `Download concluído mas erro ao obter link: ${error instanceof Error ? error.message : 'Erro desconhecido'}`  
      );
    }
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private createFailureResult(message?: string): ProcessResult {
    return {
      success: false,
      message: message || 'Operação falhou sem mensagem de erro específica'
    };
  }

  private createDownloadFailure(message: string): DownloadWaitResult {
    return { success: false, message };
  }

  private displayResult(result: ProcessResult): void {
    if (result.success) {
      console.log('SUCESSO: Magnet adicionado ao catálogo e Real-Debrid');
      console.log('Arquivo(s) principal(is):', result.mainFile);
      console.log('Arquivos selecionados:', result.selectedFiles);
      console.log('Link de download:', result.downloadLink);

      if (result.downloadTime) {
        const minutes = Math.floor(result.downloadTime / 60);
        const seconds = result.downloadTime % 60;
        console.log('Tempo total:', `${minutes}m${seconds}s`);
      }

      if (result.torrentId) {
        console.log('ID do Torrent:', result.torrentId);
      }
    } else {
      console.log(' AVISO: Magnet adicionado ao catálogo, mas download precisa de atenção');
      if (result.message) {
        console.log('Informação:', result.message);
      }
    }
  }

  private handleError(context: string, error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    console.log(` ERRO: ${context}:`, errorMessage);

    logger.error(context, {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined
    });
  }

  private cleanup(): void {
    this.rl.close();
  }

  private async addToJSON(magnetData: MagnetData): Promise<void> {
    const jsonPath = path.join(process.cwd(), 'data', 'magnets.json');

    try {
      let data: { magnets: MagnetData[] } = { magnets: [] };

      if (await fs.pathExists(jsonPath)) {
        data = await fs.readJson(jsonPath);
      }

      data.magnets.push(magnetData);
      await fs.writeJson(jsonPath, data, { spaces: 2 });

      logger.info('Magnet adicionado ao JSON', {
        title: magnetData.title,
        imdbId: magnetData.imdbId,
        quality: magnetData.quality,
        language: magnetData.language,
        category: magnetData.category
      });
    } catch (error) {
      logger.error('Erro ao salvar magnet no JSON', {
        error: error instanceof Error ? error.message : 'Erro desconhecido',
        title: magnetData.title
      });
      throw error;
    }
  }
}

if (require.main === module) {
  const adder = new MagnetAdder();
  adder.start().catch(error => {
    console.log(' ERRO CRÍTICO:', error);
    process.exit(1);
  });
}

export default MagnetAdder;