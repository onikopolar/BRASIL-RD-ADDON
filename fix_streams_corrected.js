// Script corrigido para filtrar streams
const fs = require('fs');
const path = require('path');

const filePath = './src/services/StreamHandler.ts';
let content = fs.readFileSync(filePath, 'utf8');

// 1. Primeiro, vamos remover a função problemática que foi adicionada
// Encontrar e remover a função getMovieTitle malformada
const getMovieTitleStart = content.indexOf('private async getMovieTitle(request: StreamRequest): Promise<string>');
if (getMovieTitleStart !== -1) {
    const getMovieTitleEnd = content.indexOf('}', getMovieTitleStart) + 1;
    content = content.substring(0, getMovieTitleStart) + content.substring(getMovieTitleEnd);
}

// 2. Agora vamos adicionar uma versão corrigida da função
const classEnd = content.lastIndexOf('}');
const beforeClassEnd = content.lastIndexOf('}', classEnd - 1);

const getMovieTitleFunction = `
  private async getMovieTitle(request: StreamRequest): Promise<string> {
    try {
      if (request.type === 'movie') {
        const imdbScraper = new ImdbScraperService();
        const title = await imdbScraper.getTitleFromImdbId(request.id);
        return title || request.id;
      }
      return request.id;
    } catch (error) {
      this.logger.debug('Error getting movie title, using request ID', {
        requestId: request.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return request.id;
    }
  }`;

content = content.substring(0, beforeClassEnd) + getMovieTitleFunction + content.substring(beforeClassEnd);

// 3. Vamos simplificar a lógica do processTorrentsWithRateLimit para evitar erros
// Encontrar a função novamente
const processFunctionStart = content.indexOf('private async processTorrentsWithRateLimit(');
if (processFunctionStart === -1) {
    console.error('Função processTorrentsWithRateLimit não encontrada!');
    process.exit(1);
}

// Encontrar o final da função
const processFunctionEnd = content.indexOf('private generateLazyResolveUrl', processFunctionStart);
if (processFunctionEnd === -1) {
    console.error('Fim da função não encontrado!');
    process.exit(1);
}

// Substituir toda a função por uma versão mais simples
const simpleProcessFunction = `private async processTorrentsWithRateLimit(
    torrents: ScrapedTorrent[], 
    request: StreamRequest
  ): Promise<Stream[]> {
    const allStreams: Stream[] = [];
    
    // FILTRO RIGOROSO: Só processar torrents do filme correto
    const originalTitle = await this.getMovieTitle(request);
    const normalizedOriginalTitle = this.normalizeTitleForComparison(originalTitle);
    
    // Filtrar torrents antes de processar
    const filteredTorrents = torrents.filter(torrent => {
      const normalizedTorrentTitle = this.normalizeTitleForComparison(torrent.title);
      return this.shouldSaveMagnet(normalizedTorrentTitle, normalizedOriginalTitle);
    });

    this.logger.info('Stream filtering applied', {
      requestId: request.id,
      originalTorrents: torrents.length,
      filteredTorrents: filteredTorrents.length,
      filteredOut: torrents.length - filteredTorrents.length
    });

    // Processar apenas os torrents filtrados
    for (let i = 0; i < filteredTorrents.length; i += this.processingConfig.maxConcurrentTorrents) {
      const batch = filteredTorrents.slice(i, i + this.processingConfig.maxConcurrentTorrents);

      this.logger.debug('Processing torrent batch', {
        requestId: request.id,
        batchIndex: Math.floor(i / this.processingConfig.maxConcurrentTorrents) + 1,
        batchSize: batch.length,
        qualities: batch.map(t => t.quality)
      });

      const batchPromises = batch.map(async (torrent) => {
        try {
          const streamResult = await this.processScrapedTorrentLazy(torrent, request);
          if (streamResult) {
            return streamResult;
          }
        } catch (error) {
          this.logger.error('Torrent processing failed in batch', {
            requestId: request.id,
            title: torrent.title,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
        return null;
      });

      const batchResults = await Promise.allSettled(batchPromises);
      batchResults.forEach((result) => {
        if (result.status === 'fulfilled' && result.value !== null) {
          const streams = Array.isArray(result.value) ? result.value : [result.value];
          allStreams.push(...streams);
        }
      });

      if (i + this.processingConfig.maxConcurrentTorrents < filteredTorrents.length) {
        await this.delay(this.processingConfig.delayBetweenTorrents);
      }
    }

    return allStreams;
  }`;

content = content.substring(0, processFunctionStart) + simpleProcessFunction + content.substring(processFunctionEnd);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Fix corrigido aplicado com sucesso!');
console.log('Streams agora serão filtrados rigorosamente');
console.log('Usuário só verá streams do filme correto');
