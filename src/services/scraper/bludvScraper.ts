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

      logger.debug(`BLUDV HTML: "${query}" → ${postUrls.length} posts encontrados`);

      // Passo 2: Para cada post, extrair magnets diretos do HTML
      const results: TorrentResult[] = [];
      for (const postUrl of postUrls) {
        try {
          const extracted = await this.scrapePost(postUrl, type);
          results.push(...extracted);
        } catch {
          // Post individual com problema, ignora
        }
      }

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

    // Limita a 8 posts para não demorar
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
      });
    }

    return results;
  }

  // ═══ Extrai APENAS os magnets da seção DUAL ÁUDIO do post ═══
  private extractDualSectionMagnets($: any, contentHtml: string): any[] {
    // Pega todo o texto visível pra achar a seção DUAL
    const allMagnets = $('a[href^="magnet:"]').toArray();
    if (!allMagnets.length) return [];

    // Percorre os elementos do .content em ordem, procurando a seção DUAL
    const contentEl = $('.content').get(0);
    if (!contentEl) return allMagnets; // fallback: sem .content, retorna todos

    // Acha o texto que marca a seção DUAL ÁUDIO
    const fullText = $('.content').text() || '';
    // Marcadores de seção PT-BR: "***VERSÃO MKV DUAL ÁUDIO***" ou "***DUBLADO***"
    const dualMatch = fullText.match(/\*{2,3}\s*(?:VERS[ÃA]O\s+(?:MKV|WEB-DL|BLURAY|4K|720p|1080p)\s+)?(?:DUAL\s+[ÁA]UDIO|DUBLADO)\s*\*{2,3}/i);
    
    if (!dualMatch) {
      // Se não achou marcador DUAL, retorna todos (post pode ter estrutura diferente)
      return allMagnets;
    }

    const dualMarker = dualMatch[0];
    const dualIndex = fullText.indexOf(dualMarker);

    // Busca o PRÓXIMO marcador de seção depois do DUAL (ex: "***VERSÃO WEB-DL")
    // Próximo marcador de seção: qualquer *** ou ** com texto significativo
    const nextSectionRegex = /\*{2,3}\s*[A-ZÁÀÃÉÊÍÓÔÚÇ0-9]{3,}/gi;
    let nextSectionIndex = fullText.length;
    let searchFrom = dualIndex + dualMarker.length;
    
    let nextMatch;
    while ((nextMatch = nextSectionRegex.exec(fullText)) !== null) {
      if (nextMatch.index > searchFrom) {
        nextSectionIndex = nextMatch.index;
        break;
      }
      nextSectionRegex.lastIndex = nextMatch.index + 1;
    }

    // Coleta os magnets entre dualIndex e nextSectionIndex
    const dualMagnets: any[] = [];
    for (const el of allMagnets) {
      // Pega o texto próximo ao magnet pra determinar a posição
      const elText = $(el).parent().text().trim() || $(el).text().trim();
      const elIndex = fullText.indexOf(elText.substring(0, 30));
      
      if (elIndex >= dualIndex && elIndex < nextSectionIndex) {
        dualMagnets.push(el);
      }
    }

    // Fallback: se a busca por posição falhou, retorna todos
    return dualMagnets.length > 0 ? dualMagnets : allMagnets;
  }

  // ═══ Extrai metadados do post (Áudio, Qualidade, Tamanho) ═══
  private extractPostMetadata($: any, content: string): {
    quality?: string;
    size?: string;
    language?: string;
  } {
    const text = $('.content').text() || $.text() || content.replace(/<[^>]+>/g, '');

    const qualityMatch = text.match(/Qualidade[:\s]*([^\n<]+)/i);
    const sizeMatch = text.match(/Tamanho[:\s]*([^\n<]+)/i);
    const audioMatch = text.match(/Áudio[:\s]*([^\n<]+)/i);

    return {
      quality: qualityMatch ? qualityMatch[1].trim() : undefined,
      size: sizeMatch ? sizeMatch[1].trim() : undefined,
      language: audioMatch ? audioMatch[1].trim() : undefined,
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
