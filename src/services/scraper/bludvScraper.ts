// Scraper dedicado do BLUDV — HTML scraping direto (sem WordPress API)
// Extrai magnets, Áudio:, Qualidade:, Tamanho: e episódios do conteúdo do post
import axios from 'axios';
import * as cheerio from 'cheerio';
import dns from 'dns';
import https from 'https';
import tls from 'tls';
import { Logger } from '../../utils/logger.js';
import { TorrentResult } from './torrentTypes.js';
import { QualityDetector } from '../../lib/qualityDetector.js';
import { allowedQualities } from './scraperConfigs.js';
import { analisarMagnet } from '../../magnet/magnetHelper.js';

const logger = new Logger('BludvScraper');

dns.setServers(['8.8.8.8', '1.1.1.1']);

class DnsAgent extends https.Agent {
  createConnection(options: any, cb: any): any {
    const hostname = options.hostname || options.host || '';
    (dns as any).resolve4(hostname, (err: any, addresses: string[]) => {
      if (err) return cb(err);
      const sock = tls.connect({
        host: addresses[0],
        port: options.port || 443,
        servername: hostname,
        rejectUnauthorized: false,
      }, () => cb(null, sock));
      sock.on('error', cb);
    });
    return undefined as any;
  }
}

const dnsAgent = new DnsAgent({ keepAlive: true });
const lookupCustomizado = (hostname: string, _opts: any, cb: any) => {
  dns.resolve4(hostname, (err, addresses) => {
    if (err) return cb(err);
    cb(null, addresses[0], 4);
  });
};

const BASE_URL = 'https://bludvfilmes.xyz';
const PROVIDER = 'BLUDV Filmes';
const AXIOS_OPTS = {
  timeout: 15000,
  httpsAgent: dnsAgent,
  lookup: lookupCustomizado,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    'Accept': 'text/html',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5',
  },
};

export class BludvScraper {
  private readonly qualityDetector: QualityDetector;

  constructor() {
    this.qualityDetector = new QualityDetector();
  }

  async search(query: string, type: 'movie' | 'series'): Promise<TorrentResult[]> {
    try {
      // Passo 1: Buscar posts na página de pesquisa HTML do WordPress
      const postUrls = await this.searchPosts(query);
      if (!postUrls.length) return [];

      logger.info(`BLUDV HTML: ${postUrls.length} posts encontrados para "${query}"`);

      // Passo 2: Extrair magnets de TODOS os posts em PARALELO
      const postResults = await Promise.all(
        postUrls.map(url => this.scrapePost(url, type).catch(() => [] as TorrentResult[]))
      );
      const results = postResults.flat();

      // logger.debug(`BLUDV HTML: ${results.length} magnets extraídos de ${postUrls.length} posts`);
      return results;
    } catch (err: any) {
      logger.warn(`BLUDV HTML falhou: ${err.code || err.message}`);
      return [];
    }
  }

  // ═══ Busca posts via /?s=query (HTML) ═══
  private async searchPosts(query: string): Promise<string[]> {
    const encoded = encodeURIComponent(query);
    const searchUrl = `${BASE_URL}/?s=${encoded}`;

    const res = await axios.get(searchUrl, AXIOS_OPTS);
    const $ = cheerio.load(res.data);
    const postUrls: string[] = [];

    // BLUDV usa tema customizado — posts têm slug longo (1 segmento, >20 chars, com hífens)
    // Categorias/tags são curtas: /filmes/, /series/, /lancamento/2024/, /resolucao/1080p/
    $('a[href]').each((_, el) => {
      const href = ($(el).attr('href') || '').trim();
      if (!href.includes('bludvfilmes.xyz')) return;
      
      const path = href.replace(/^https?:\/\/bludvfilmes\.xyz/, '').replace(/\/$/, '');
      const segments = path.split('/').filter(Boolean);
      
      // Post: 1 segmento longo e descritivo com hífens
      if (segments.length === 1 && segments[0].length > 20 && segments[0].includes('-')) {
        const fullUrl = href.startsWith('http') ? href : `${BASE_URL}/${segments[0]}/`;
        if (!postUrls.includes(fullUrl)) {
          postUrls.push(fullUrl);
        }
      }
    });

    // Limita a 8 posts (rodam em paralelo via Promise.all)
    return postUrls.slice(0, 8);
  }

  // ═══ Extrai magnets de um post individual ═══
  private async scrapePost(postUrl: string, type: 'movie' | 'series'): Promise<TorrentResult[]> {
    const res = await axios.get(postUrl, AXIOS_OPTS);
    const $ = cheerio.load(res.data);
    
    // BLUDV usa .content como wrapper principal (tema customizado, sem article/.entry-content)
    const contentHtml = $('.content').html() || $('body').html() || '';
    if (!contentHtml) return [];

    // Título do post
    const postTitle = $('h1').first().text().trim() ||
      $('title').first().text().trim().replace(/\s*[-–]\s*BLUDV FILMES.*$/, '');

    // Extrai metadados do post
    const metadata = this.extractPostMetadata($, contentHtml);

    // ═══ BLUDV tem seções no post: "***VERSÃO MKV DUAL ÁUDIO***" (PT-BR) 
    // e outras seções com versões internacionais (NTb/rartv).
    // Só pegamos magnets da seção DUAL ÁUDIO. ═══
    const dualMagnets = this.extractDualSectionMagnets($, contentHtml);
    
    if (!dualMagnets.length) return [];

    const results: TorrentResult[] = [];

    for (const magnetEl of dualMagnets) {
      const magnet = $(magnetEl).attr('href');
      if (!magnet) continue;

      const canonicalName = this.extractDnFromMagnet(magnet);
      const parentText = $(magnetEl).parent().text().trim();
      const episodeLabel = this.extractEpisodeLabel(parentText);

      let resultTitle = canonicalName || postTitle;
      if (type === 'series' && episodeLabel) {
        resultTitle = `${postTitle} ${episodeLabel}`.replace(/\s+/g, ' ').trim();
      }

      // Qualidade: do nome do magnet primeiro, depois do corpo do post
      let quality = this.qualityDetector.extractQualityFromFilename(canonicalName || resultTitle);
      if (quality === 'HD') {
        const bodyQuality = this.qualityDetector.extractQualityFromFilename(contentHtml);
        if (bodyQuality && bodyQuality !== 'HD') quality = bodyQuality;
      }
      if (quality === 'HD') {
        quality = this.qualityDetector.extractQualityFromFilename(parentText) || quality;
      }
      if (!allowedQualities.has(quality)) continue;

      const size = metadata.size || 'Desconhecido';
      const language = metadata.language || 'Desconhecido';

      results.push({
        title: this.cleanTitle(resultTitle),
        magnet,
        seeders: this.estimateSeeders(),
        leechers: 0,
        size,
        quality,
        provider: PROVIDER,
        language,
        type,
        relevanceScore: 0.85,
        sizeInBytes: this.parseSize(size),
        season: undefined,
        lastUpdated: new Date(),
        confidence: 0.9,
        originalTitle: metadata.originalTitle,
      });
    }

    return results;
  }

  // ═══ Extrai APENAS os magnets da seção DUAL ÁUDIO do post ═══
  // Estrutura real do BLUDV:
  //   <strong>VERSÃO MKV DUAL ÁUDIO</strong>        ← início coleta
  //     SERVIDOR PARA DOWNLOAD → Magnet DUAL ✅
  //   <strong>VERSÃO MP4 LEGENDADO</strong>          ← PARAR aqui
  //     SERVIDOR PARA DOWNLOAD → Magnet LEGENDADO ❌
  private extractDualSectionMagnets($: any, contentHtml: string): any[] {
    const allMagnets = $('a[href^="magnet:"]').toArray();
    if (!allMagnets.length) return [];

    // ═══ Passo 1: Encontra o <strong> que marca o início da seção DUAL ═══
    const strongEls = $('.content strong, .content b').toArray();
    let dualStrongIdx = -1;
    let legendadoStrongIdx = -1;

    for (let i = 0; i < strongEls.length; i++) {
      const text = $(strongEls[i]).text().trim();
      
      // Detecta início da seção DUAL (DUAL ÁUDIO ou DUBLADO)
      if (dualStrongIdx === -1 && /\b(?:DUAL\s+[ÁA]UDIO|DUBLADO)\b/i.test(text)) {
        dualStrongIdx = i;
        continue;
      }
      
      // Depois do DUAL, detecta limite LEGENDADO
      if (dualStrongIdx !== -1 && legendadoStrongIdx === -1 && /\b(?:LEGENDADO|LEGENDADA)\b/i.test(text)) {
        legendadoStrongIdx = i;
        break; // já achamos o boundary, não precisa continuar
      }
    }

    if (dualStrongIdx === -1) {
      // Não achou seção DUAL → retorna todos (post pode ter estrutura diferente)
      return allMagnets;
    }

    // ═══ Passo 2: Determina posições no HTML ═══
    const dualHtml = $(strongEls[dualStrongIdx]).toString();
    const dualPos = contentHtml.indexOf(dualHtml);
    if (dualPos === -1) return allMagnets;

    let legendadoPos = contentHtml.length;
    if (legendadoStrongIdx !== -1) {
      const legendadoHtml = $(strongEls[legendadoStrongIdx]).toString();
      const pos = contentHtml.indexOf(legendadoHtml);
      if (pos > dualPos) legendadoPos = pos;
    }

    // ═══ Passo 3: Coleta magnets entre dualPos e legendadoPos ═══
    const dualMagnets: any[] = [];
    for (const el of allMagnets) {
      const magnetHtml = $(el).toString();
      const magnetPos = contentHtml.indexOf(magnetHtml);
      
      if (magnetPos > dualPos && magnetPos < legendadoPos) {
        dualMagnets.push(el);
      }
    }

    return dualMagnets;
  }

  // ═══ Extrai metadados do post (Áudio, Qualidade, Tamanho, Título Original) ═══
  private extractPostMetadata($: any, content: string): {
    quality?: string;
    size?: string;
    language?: string;
    originalTitle?: string;
  } {
    const text = $('.content').text() || $.text() || content.replace(/<[^>]+>/g, '');

    const qualityMatch = text.match(/Qualidade[:\s]*([^\n<]+)/i);
    const sizeMatch = text.match(/Tamanho[:\s]*([^\n<]+)/i);
    const audioMatch = text.match(/Áudio[:\s]*([^\n<]+)/i);

    // Extrai Título Original da seção >>INFORMAÇÕES DO FILME<<
    // Padrão: "Título Original: Nome Do Filme" ou "Título Original: Nome Do Filme (Ano)"
    const originalTitleMatch = text.match(/T[ií]tulo\s+Original[:\s]+([^\n<]+)/i);
    const originalTitle = originalTitleMatch?.[1]
      ? originalTitleMatch[1].replace(/\(\d{4}\)$/, '').trim()
      : undefined;
    const originalTitleFinal = (originalTitle && originalTitle.length >= 3) ? originalTitle : undefined;

    return {
      quality: qualityMatch ? qualityMatch[1].trim() : undefined,
      size: sizeMatch ? sizeMatch[1].trim() : undefined,
      language: audioMatch ? audioMatch[1].trim() : undefined,
      originalTitle: originalTitleFinal,
    };
  }

  // ═══ Extrai label de episódio do texto ═══
  private extractEpisodeLabel(text: string): string | null {
    const epMatch = text.match(/(?:EPIS[ÓO]DIO|Epis[óo]dio)\s*(\d{1,2})/i);
    if (epMatch) {
      return `E${epMatch[1].padStart(2, '0')}`;
    }
    return null;
  }

  // ═══ Extrai nome canônico (dn) do magnet ═══
  private extractDnFromMagnet(magnet: string): string | null {
    const dnMatch = magnet.match(/[&?]dn=([^&]+)/i);
    if (dnMatch) {
      try {
        return decodeURIComponent(dnMatch[1].replace(/\+/g, ' '));
      } catch {
        return dnMatch[1];
      }
    }
    return null;
  }

  // ═══ Extrai infoHash do magnet ═══
  private async extrairInfoHash(magnet: string): Promise<string | null> {
    const dados = await analisarMagnet(magnet);
    return dados ? dados.infoHash : null;
  }

  // ═══ Helpers ═══

  private cleanTitle(title: string): string {
    return title
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private estimateSeeders(): number {
    return Math.floor(30 + Math.random() * 60); // 30-90 seeds
  }

  private parseSize(sizeStr: string): number {
    if (!sizeStr || sizeStr === 'Desconhecido' || sizeStr === '–') return 0;
    const match = sizeStr.match(/([\d,.]+)\s*(GB|MB|KB)/i);
    if (!match) return 0;
    const num = parseFloat(match[1].replace(',', '.'));
    const unit = match[2].toUpperCase();
    if (unit === 'GB') return num * 1024 * 1024 * 1024;
    if (unit === 'MB') return num * 1024 * 1024;
    if (unit === 'KB') return num * 1024;
    return 0;
  }
}
