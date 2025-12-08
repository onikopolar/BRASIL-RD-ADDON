# Vamos criar um patch para corrigir a função convertDatabaseEntryToStream
# Primeiro, vamos ver a função completa

cat > /tmp/patch_streamhandler.js << 'PATCH'
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/services/StreamHandler.ts');
let content = fs.readFileSync(filePath, 'utf8');

// Encontrar a função convertDatabaseEntryToStream
const functionStart = content.indexOf('private convertDatabaseEntryToStream(');
if (functionStart === -1) {
  console.error('Função não encontrada');
  process.exit(1);
}

// Encontrar o fim da função (próxima função ou fim do método)
let functionEnd = content.indexOf('\n  private async', functionStart);
if (functionEnd === -1) {
  functionEnd = content.length;
}

const oldFunction = content.substring(functionStart, functionEnd);

// Nova versão da função com formato Torrentio
const newFunction = `  private convertDatabaseEntryToStream(fileEntry: any, torrent: any, request: StreamRequest): Stream | null {
    try {
      const magnetHash = torrent.infoHash;
      const quality = this.qualityDetector.extractQualityFromFilename(torrent.title);
      const magnetLink = \`magnet:?xt=urn:btih:\${magnetHash}\`;

      let titleSuffix = '';
      let season: number | undefined;
      let episode: number | undefined;

      if (request.type === 'series') {
        const match = request.id.match(/tt\\d+:(\\d+):(\\d+)/);
        if (match) {
          season = parseInt(match[1]);
          episode = parseInt(match[2]);
          titleSuffix = \` S\${season!.toString().padStart(2, '0')}E\${episode!.toString().padStart(2, '0')}\`;
        }
      }

      // Extrai o nome do arquivo do modelo File
      const filename = fileEntry.title || 'video.mkv';
      const fileIndex = fileEntry.fileIndex || 0;

      const stream: Stream = {
        title: torrent.title,
        name: \`Brasil RD (\${quality})\${titleSuffix}\`,
        description: \`\${torrent.title}\\n\${torrent.seeders || 0} seeds | \${torrent.size || 'N/A'}\`,
        sources: [magnetLink],
        behaviorHints: { notWebReady: false, bingeGroup: \`br-db-\${request.id}\` },
        status: 'available',
        infoHash: magnetHash,
        magnet: magnetLink,
        url: generateLazyResolveUrl(
          magnetLink,
          request.apiKey!,
          filename,  // Nome do arquivo
          fileIndex, // Índice do arquivo
          request.type,
          season,
          episode
        )
      };

      return stream;
    } catch (error) {
      return null;
    }
  }`;

// Substituir a função
content = content.substring(0, functionStart) + newFunction + content.substring(functionEnd);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Função atualizada com sucesso!');
PATCH

node /tmp/patch_streamhandler.js
