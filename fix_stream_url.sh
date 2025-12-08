#!/bin/bash

# Encontrar a linha onde começa a função
start_line=$(grep -n "private convertDatabaseEntryToStream" src/services/StreamHandler.ts | cut -d: -f1)

if [ -z "$start_line" ]; then
    echo "Função não encontrada!"
    exit 1
fi

# Encontrar a linha onde termina a função (próxima função)
end_line=$(sed -n "$start_line,\$p" src/services/StreamHandler.ts | grep -n "private async getStreamsFromCatalog" | head -1 | cut -d: -f1)
end_line=$((start_line + end_line - 2))

echo "Função encontrada: linha $start_line a $end_line"

# Criar arquivo temporário com a correção
cat > /tmp/fixed_function.ts << 'FUNCTION'
  private convertDatabaseEntryToStream(fileEntry: any, torrent: any, request: StreamRequest): Stream | null {
    try {
      const magnetHash = torrent.infoHash;
      const quality = this.qualityDetector.extractQualityFromFilename(torrent.title);
      const magnetLink = \`magnet:?xt=urn:btih:\${magnetHash}\`;

      let titleSuffix = '';
      let season: number | undefined;
      let episode: number | undefined;

      if (request.type === 'series') {
        const match = request.id.match(/tt\d+:(\d+):(\d+)/);
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
  }
FUNCTION

# Substituir a função no arquivo original
head -n $((start_line - 1)) src/services/StreamHandler.ts > /tmp/part1.ts
cat /tmp/fixed_function.ts > /tmp/part2.ts
tail -n +$((end_line + 1)) src/services/StreamHandler.ts > /tmp/part3.ts

# Juntar tudo
cat /tmp/part1.ts /tmp/part2.ts /tmp/part3.ts > src/services/StreamHandler.ts.fixed
mv src/services/StreamHandler.ts.fixed src/services/StreamHandler.ts

echo "Função atualizada com sucesso!"
