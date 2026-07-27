/**
 * Teste: Verificar se o site starckfilmes retorna resultados.
 * 
 * Testa várias URLs e queries para diagnosticar problemas.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import https from 'https';

const agent = new https.Agent({ rejectUnauthorized: false });

const SITE = 'starckfilmes';
const BASE_URLS = [
  // URL atual no wordpressScraper (provavelmente errada - tem /validation)
  'https://www.starckfilmes-v23.com/validation',
  // URL correta (sem o path extra)
  'https://www.starckfilmes-v23.com',
  // Alternativas comuns
  'https://starckfilmes-v23.com',
];

const QUERIES = [
  'avatar',
  'aang',
  'korra',
  'vingadores',
  'matrix',
];

async function testUrl(baseUrl: string, query: string) {
  const apiUrl = `${baseUrl}/wp-json/wp/v2/posts?search=${encodeURIComponent(query)}&per_page=5&_fields=id,title,link,date`;

  const config = {
    timeout: 15000,
    httpsAgent: agent,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'pt-BR,pt;q=0.9',
    },
  };

  try {
    const start = Date.now();
    const response = await axios.get(apiUrl, config);
    const elapsed = Date.now() - start;

    if (Array.isArray(response.data)) {
      if (response.data.length > 0) {
        console.log(`   ✅ ${response.data.length} posts (${elapsed}ms)`);
        for (const post of response.data.slice(0, 3)) {
          const title = post.title?.rendered || '(sem título)';
          const magnetCount = (post.content?.rendered || '').match(/magnet:\?/g)?.length || 0;
          console.log(`      - "${title.substring(0, 80)}" [${magnetCount} magnets]`);
        }
        return true;
      } else {
        console.log(`   ⚠️  0 posts (${elapsed}ms) — API retornou array vazio`);
        return false;
      }
    } else {
      console.log(`   ❌ Resposta não é array: ${typeof response.data} (${elapsed}ms)`);
      console.log(`      Headers: ${JSON.stringify(response.headers).substring(0, 200)}`);
      return false;
    }
  } catch (err: any) {
    const status = err.response?.status;
    const code = err.code;
    const msg = err.message?.substring(0, 100);
    console.log(`   ❌ Erro: ${status || code || msg}`);
    return false;
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log(`TESTE: ${SITE} — WordPress API`);
  console.log('='.repeat(80));

  let anySuccess = false;

  for (const baseUrl of BASE_URLS) {
    console.log(`\n📍 Base URL: ${baseUrl}`);
    console.log(`   API endpoint: ${baseUrl}/wp-json/wp/v2/posts?search=...`);
    
    for (const query of QUERIES) {
      console.log(`   🔍 Query: "${query}"`);
      const ok = await testUrl(baseUrl, query);
      if (ok) anySuccess = true;
    }
  }

  // Também testa a home page para ver se o site responde
  console.log('\n' + '─'.repeat(80));
  console.log('🌐 Teste de conectividade básica (home page):');
  for (const baseUrl of ['https://www.starckfilmes-v23.com']) {
    try {
      const start = Date.now();
      const resp = await axios.get(baseUrl, {
        timeout: 15000,
        httpsAgent: agent,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        maxRedirects: 5,
      });
      console.log(`   ✅ ${baseUrl} → ${resp.status} (${Date.now() - start}ms)`);
    } catch (err: any) {
      console.log(`   ❌ ${baseUrl} → ${err.code || err.response?.status || err.message?.substring(0, 80)}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  if (anySuccess) {
    console.log('✅ Pelo menos uma URL funcionou!');
  } else {
    console.log('❌ Nenhuma URL retornou resultados.');
    console.log('   Possíveis causas:');
    console.log('   1. Site mudou de domínio');
    console.log('   2. API WordPress desabilitada');
    console.log('   3. Bloqueio de IP / Cloudflare');
    console.log('   4. baseUrl com /validation quebrando o path da API');
  }
  console.log('='.repeat(80));
}

main().catch(console.error);
