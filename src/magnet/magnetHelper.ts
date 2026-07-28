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
  // cheerio.load().text() decodifica &ccedil; → ç, &atilde; → ã, etc.
  // Usamos <span> que é uma tag HTML válida (diferente de <d> que falhava)
  const cheerio = require('cheerio');
  return cheerio.load(`<span>${text}</span>`)('span').text();
}

// ── Tipos ─────────────────────────────────────────────────────────────

export interface DadosMagnet {
  infoHash: string;    // hex 40 caracteres, lowercase
  nome: string | null; // parametro "dn" do magnet (nome canonico do torrent)
  anuncios: string[];  // trackers (parametro "tr")
}

// ── API UNICA de analise de magnets ───────────────────────────────────

/**
 * Analisa um magnet link usando parse-torrent.
 * UNICA forma de extrair infoHash no sistema — sem regex, sem fallback.
 *
 * Retorna dados estruturados: infoHash, nome canonico (dn), trackers.
 * Retorna null se o magnet for invalido ou o parse falhar.
 */
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

/**
 * Gera a URL lazy de resolucao para o Stremio.
 * Extrai o infoHash do magnet via parse-torrent.
 */
export async function gerarUrlResolve(
  magnet: string,
  chaveApi: string,
  nomeArquivo: string = 'video.mkv',
  indiceArquivo: number = 0,
  tipo?: 'movie' | 'series',
  temporada?: number,
  episodio?: number,
  qualidade?: string,
  infoHashPreParsed?: string // evita re-parse do magnet
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

  const consulta = parametros.toString();
  if (consulta) url += `?${consulta}`;

  return url;
}
