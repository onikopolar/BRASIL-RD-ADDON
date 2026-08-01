// Verifica idioma dos posts do BLUDV lendo o HTML
const axios = require('axios');
const cheerio = require('cheerio');

const QUERIES = ['Rick and Morty', 'Vingadores', 'Game of Thrones', 'Matrix', 'Harry Potter', 'Velozes', 'Avatar'];

async function main() {
  for (const query of QUERIES) {
    const url = `https://bludvfilmes.xyz/wp-json/wp/v2/posts?search=${encodeURIComponent(query)}&per_page=5&_fields=id,title,content`;
    const res = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
    });

    const posts = Array.isArray(res.data) ? res.data : [];
    console.log(`\n${query}: ${posts.length} posts`);
    
    for (const post of posts) {
      const $ = cheerio.load(post.content?.rendered || '');
      const text = ($('body').text() || $.text() || '').replace(/\s+/g, ' ').trim();
      
      // Extrai seção de áudio/idioma
      const audioMatch = text.match(/Áudio[:\s]*([^\n]{5,50})/i);
      const idiomaMatch = text.match(/Idioma[:\s]*([^\n]{5,50})/i);
      const lang = audioMatch?.[1]?.trim() || idiomaMatch?.[1]?.trim() || '?';
      
      // Verifica indicadores no título
      const title = post.title?.rendered || '';
      const hasDual = /dual/i.test(title);
      const hasDub = /dublado/i.test(title);
      const hasLeg = /legendado/i.test(title);
      
      const emoji = (hasDual || hasDub) ? '✅' : hasLeg ? '⚠️' : '❓';
      console.log(`  ${emoji} Áudio: "${lang.substring(0,40)}" | ${title.substring(0,60)}`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
