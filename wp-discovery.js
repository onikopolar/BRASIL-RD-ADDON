const path = require('path');
const axios = require('axios');

const wp = require(path.join(__dirname, 'dist/services/scraper/wordpressScraper.js'));
const { jsonAxiosConfig, WP_SITES } = wp;

(async () => {
  const site = WP_SITES[0];
  const queries = ['reacher', 'the last of us', 'breaking bad', 'round 6'];

  for (const q of queries) {
    const url = `${site.baseUrl}/wp-json/wp/v2/posts?search=${encodeURIComponent(q)}&per_page=5&_fields=id,title,link`;
    console.log(`\n=== Query: "${q}" ===`);
    try {
      const res = await axios.get(url, jsonAxiosConfig);
      console.log(`Posts encontrados: ${res.data.length}`);
      res.data.forEach((p, i) => {
        console.log(`  #${i + 1}`);
        console.log(`    id:    ${p.id}`);
        console.log(`    title: ${p.title.rendered}`);
        console.log(`    link:  ${p.link}`);
      });
    } catch (e) {
      console.log(`  ERRO: ${e.message}`);
    }
  }
})().catch(e => console.error('FATAL:', e));
