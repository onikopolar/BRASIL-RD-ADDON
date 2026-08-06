// ── Carregamento lazy do parse-torrent (ESM) ──────────────────────────

let analisadorTorrent: any = null;

async function carregarAnalisador() {
  if (!analisadorTorrent) {
    const modulo = await import('parse-torrent');
    analisadorTorrent = modulo.default;
  }
  return analisadorTorrent;
}

// ── Decode HTML entities via cheerio (tag <span> é válida) ────────────

function decodeHtmlEntities(text: string): string {
  const cheerio = require('cheerio');
  return cheerio.load(`<span>${text}</span>`)('span').text();
}

// ── Tipos ─────────────────────────────────────────────────────────────

export interface DadosMagnet {
  infoHash: string;
  nome: string | null;
  anuncios: string[];
}

// ── API UNICA de analise de magnets ───────────────────────────────────

export async function analisarMagnet(magnet: string): Promise<DadosMagnet | null> {
  try {
    const analisador = await carregarAnalisador();
    const resultado = await analisador(magnet);
    if (!resultado || !resultado.infoHash) return null;
    return {
      infoHash: resultado.infoHash.toLowerCase(),
      nome: resultado.name ? decodeHtmlEntities(resultado.name) : null,
      anuncios: Array.isArray(resultado.announce) ? resultado.announce : []
    };
  } catch {
    return null;
  }
}

// ── Geracao de URL de resolucao ───────────────────────────────────────

export async function gerarUrlResolve(
  magnet: string,
  chaveApi: string,
  nomeArquivo: string = 'video.mkv',
  indiceArquivo: number = 0,
  tipo?: 'movie' | 'series',
  temporada?: number,
  episodio?: number,
  qualidade?: string,
  infoHashPreParsed?: string,
  titles?: string[],
  imdbId?: string
): Promise<string> {
  const infoHash = infoHashPreParsed || (await analisarMagnet(magnet))?.infoHash;
  if (!infoHash) {
    throw new Error('Nao foi possivel extrair infoHash do magnet');
  }

  const arquivoCodificado = encodeURIComponent(nomeArquivo);

  const baseUrl = process.env.BASE_URL
    || (process.env.RAILWAY_STATIC_URL
      ? `https://${process.env.RAILWAY_STATIC_URL}`
      : `http://localhost:${process.env.PORT || 7000}`);

  let url = `${baseUrl}/resolve/torbox/${chaveApi}/${infoHash}/null/${indiceArquivo}/${arquivoCodificado}`;

  const parametros = new URLSearchParams();
  if (tipo) parametros.append('type', tipo);
  if (tipo === 'series' && temporada !== undefined) {
    parametros.append('season', temporada.toString());
    if (episodio !== undefined) parametros.append('episode', episodio.toString());
  }
  if (qualidade) parametros.append('quality', qualidade);
  if (imdbId) parametros.append('imdbId', imdbId);
  if (titles && titles.length > 0) {
    parametros.append('titles', titles.join(','));
  }

  const consulta = parametros.toString();
  if (consulta) url += `?${consulta}`;

  return url;
}