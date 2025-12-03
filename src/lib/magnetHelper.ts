export function extractHashFromMagnet(magnet: string): string | null {
  const match = magnet.match(/btih:([a-zA-Z0-9]+)/i);
  return match ? match[1].toLowerCase() : null;
}

export function generateLazyResolveUrl(
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
  
  // ✅ Adicionar type se fornecido
  if (type) {
    url += `&type=${type}`;
  }
  
  // ✅ Adicionar season/episode para séries
  if (type === 'series' && season !== undefined) {
    url += `&season=${season}`;
    if (episode !== undefined) {
      url += `&episode=${episode}`;
    }
  }

  return url;
}