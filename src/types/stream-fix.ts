// Interface corrigida para compatibilidade mobile
export interface MobileStream {
  title: string;
  name: string;
  description?: string;
  sources: string[];
  behaviorHints?: {
    notWebReady?: boolean;
    bingeGroup?: string;
    filename?: string;
  };
  infoHash?: string;
  fileIdx?: number;
}

// Função para converter Stream para MobileStream
export function convertToMobileStream(stream: any): MobileStream {
  // Extrai infoHash do magnet link
  const magnetMatch = stream.url?.match(/btih:([a-zA-Z0-9]+)/i);
  const infoHash = magnetMatch ? magnetMatch[1] : undefined;
  
  // Converte magnet URL para formato sources do Torrentio
  const sources = stream.url?.startsWith('magnet:') 
    ? [`dht:${infoHash}`] 
    : [stream.url];
  
  return {
    title: stream.title || 'Stream',
    name: stream.name || 'Brasil RD',
    description: stream.description,
    sources: sources,
    behaviorHints: stream.behaviorHints,
    infoHash: infoHash,
    fileIdx: stream.fileIndex
  };
}

// Função para converter array de streams
export function convertStreamsToMobile(streams: any[]): MobileStream[] {
  return streams.map(convertToMobileStream);
}
