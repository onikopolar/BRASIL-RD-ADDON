// Solução simples para filtrar streams
const fs = require('fs');
const path = require('path');

const filePath = './src/services/StreamHandler.ts';
let content = fs.readFileSync(filePath, 'utf8');

// 1. Encontrar onde os torrents são processados para streams
// Vamos modificar a função onde os torrents são processados

// Primeiro, vamos encontrar a função que chama processTorrentsWithRateLimit
const searchFunctionStart = content.indexOf('async searchAndProcessTorrents(');
if (searchFunctionStart === -1) {
    console.error('Função searchAndProcessTorrents não encontrada!');
    process.exit(1);
}

// Encontrar a chamada para processTorrentsWithRateLimit
const processCall = content.indexOf('const streams = await this.processTorrentsWithRateLimit(torrentResults, request);');
if (processCall === -1) {
    console.error('Chamada para processTorrentsWithRateLimit não encontrada!');
    process.exit(1);
}

// Substituir por uma versão que filtra antes
const newProcessCall = `    // FILTRO RIGOROSO: Filtrar torrents antes de processar streams
    const filteredTorrentResults = torrentResults.filter(torrent => {
      const normalizedOriginalTitle = this.normalizeTitleForComparison(title);
      const normalizedTorrentTitle = this.normalizeTitleForComparison(torrent.title);
      const shouldInclude = this.shouldSaveMagnet(normalizedTorrentTitle, normalizedOriginalTitle);
      
      if (!shouldInclude) {
        this.logger.debug('FILTERING stream - title mismatch', {
          originalTitle: title,
          torrentTitle: torrent.title
        });
      }
      
      return shouldInclude;
    });

    this.logger.info('Stream filtering applied', {
      requestId: request.id,
      originalTorrents: torrentResults.length,
      filteredTorrents: filteredTorrentResults.length,
      filteredOut: torrentResults.length - filteredTorrentResults.length
    });

    const streams = await this.processTorrentsWithRateLimit(filteredTorrentResults, request);`;

content = content.substring(0, processCall) + newProcessCall + content.substring(processCall + 'const streams = await this.processTorrentsWithRateLimit(torrentResults, request);'.length);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Fix simples aplicado com sucesso!');
console.log('Streams agora serão filtrados com o mesmo critério rigoroso');
console.log('Usuário só verá streams do filme correto');
