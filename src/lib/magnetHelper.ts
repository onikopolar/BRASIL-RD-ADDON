function base32ToHex(base32: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = base32.toUpperCase().replace(/=+$/, '');
  let bits = '';
  for (let i = 0; i < cleaned.length; i++) {
    const val = alphabet.indexOf(cleaned[i]);
    if (val === -1) throw new Error(`Caractere inválido em Base32: ${cleaned[i]}`);
    bits += val.toString(2).padStart(5, '0');
  }
  // Pega apenas os primeiros 160 bits (SHA-1) - ignora padding extra
  const relevantBits = bits.slice(0, 160);
  let hex = '';
  for (let i = 0; i < relevantBits.length; i += 4) {
    const nibble = relevantBits.substring(i, i + 4);
    hex += parseInt(nibble, 2).toString(16);
  }
  return hex.padStart(40, '0').slice(0, 40).toLowerCase();
}

export function extractHashFromMagnet(magnet: string): string | null {
  const match = magnet.match(/btih:([a-zA-Z0-9]+)/i);
  if (!match) return null;
  let hash = match[1].toLowerCase();
  // Se for Base32 (32 caracteres), converte para hex
  if (hash.length === 32 && /^[a-z2-7]+$/.test(hash)) {
    try {
      hash = base32ToHex(hash);
    } catch {
      return null;
    }
  } else if (hash.length !== 40 || !/^[a-f0-9]{40}$/.test(hash)) {
    return null; // formato inválido
  }
  return hash;
}

export function generateLazyResolveUrl(
  magnet: string,
  apiKey: string,
  filename: string = 'video.mkv',
  fileIndex: number = 0,
  type?: 'movie' | 'series',
  season?: number,
  episode?: number
): string {
  const infoHash = extractHashFromMagnet(magnet);
  if (!infoHash) {
    throw new Error('Could not extract info hash from magnet');
  }

  const domain = process.env.RAILWAY_STATIC_URL || "localhost:7000";
  const protocol = process.env.RAILWAY_STATIC_URL ? "https" : "http";
  const encodedFilename = encodeURIComponent(filename);
  
  let url = `${protocol}://${domain}/resolve/realdebrid/${apiKey}/${infoHash}/null/${fileIndex}/${encodedFilename}`;
  
  const params = new URLSearchParams();
  if (type) params.append('type', type);
  if (type === 'series' && season !== undefined) {
    params.append('season', season.toString());
    if (episode !== undefined) params.append('episode', episode.toString());
  }
  
  const queryString = params.toString();
  if (queryString) url += `?${queryString}`;
  
  return url;
}

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
  if (type) url += `&type=${type}`;
  if (type === 'series' && season !== undefined) {
    url += `&season=${season}`;
    if (episode !== undefined) url += `&episode=${episode}`;
  }
  return url;
}