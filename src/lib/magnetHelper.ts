export function extractHashFromMagnet(magnet: string): string | null {
  const match = magnet.match(/btih:([a-zA-Z0-9]+)/i);
  return match ? match[1].toLowerCase() : null;
}

// ✅ CORRIGIDO: Agora gera URL no formato Torrentio
export function generateLazyResolveUrl(
  magnet: string,
  apiKey: string,
  filename: string = 'video.mkv',
  fileIndex: number = 0,
  type?: 'movie' | 'series',
  season?: number,
  episode?: number
): string {
  // Extrai o info hash do magnet
  const infoHash = extractHashFromMagnet(magnet);
  if (!infoHash) {
    throw new Error('Could not extract info hash from magnet');
  }

  const domain = process.env.RAILWAY_STATIC_URL || "localhost:7000";
  const protocol = process.env.RAILWAY_STATIC_URL ? "https" : "http";
  
  // Codifica o nome do arquivo para URL
  const encodedFilename = encodeURIComponent(filename);
  
  // ✅ FORMATO TORRENTIO CORRETO:
  // /resolve/realdebrid/{api_key}/{info_hash}/null/{file_index}/{filename}
  let url = `${protocol}://${domain}/resolve/realdebrid/${apiKey}/${infoHash}/null/${fileIndex}/${encodedFilename}`;
  
  // ✅ Adiciona parâmetros adicionais como query string (opcional)
  const params = new URLSearchParams();
  
  if (type) {
    params.append('type', type);
  }
  
  if (type === 'series' && season !== undefined) {
    params.append('season', season.toString());
    if (episode !== undefined) {
      params.append('episode', episode.toString());
    }
  }
  
  const queryString = params.toString();
  if (queryString) {
    url += `?${queryString}`;
  }
  
  return url;
}

// Mantém a função antiga para compatibilidade
export function generateOldLazyResolveUrl(
  magnet: string,
  apiKey: string,
  type?: 'movie' | 'series',
  season?: number,
  episode?: number
): string {
  const encodedMagnet = Buffer.from(magnet).toString('base64');
  const domain = process.env.RAILWAY_STATIC_URL || "localhost:7000";
  const protocol = process.env.RAILWAY_STATIC_URL ? "https" : "http";

  let url = `${protocol}://${domain}/resolve/${encodedMagnet}?apiKey=${encodeURIComponent(apiKey)}`;

  if (type) {
    url += `&type=${type}`;
  }

  if (type === 'series' && season !== undefined) {
    url += `&season=${season}`;
    if (episode !== undefined) {
      url += `&episode=${episode}`;
    }
  }

  return url;
}
