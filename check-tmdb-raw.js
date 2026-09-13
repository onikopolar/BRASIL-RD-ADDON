const https = require('https');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf8');
const match = env.match(/TMDB_API_KEY\s*=\s*["']?([^"'\r\n]+)/);
const key = match ? match[1].trim() : '';

if (!key) {
  console.log('TMDB_API_KEY não encontrada no .env');
  process.exit(1);
}

const url = `https://api.themoviedb.org/3/tv/94605/season/1?api_key=${key}&language=pt-BR`;

https.get(url, res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      const eps = json.episodes || [];

      console.log('=== EPISÓDIOS (primeiros 3) ===');
      eps.slice(0, 3).forEach(ep => {
        console.log(`${ep.episode_number} | ${ep.name}`);
      });

      console.log('\n=== HEX DO EP 2 (primeiros 80 bytes) ===');
      const nome = eps[1]?.name || '';
      console.log(Buffer.from(nome, 'utf8').toString('hex').substring(0, 160));

      console.log('\n=== COMO STRING UTF-8 ===');
      console.log(nome);

      console.log('\n=== SE FOSSE LATIN1 (reinterpretado) ===');
      console.log(Buffer.from(nome, 'latin1').toString('utf8'));
    } catch (e) {
      console.error('Erro ao parsear:', e.message);
      console.log('Resposta crua (primeiros 500):', data.substring(0, 500));
    }
  });
}).on('error', e => console.error('Erro na requisição:', e.message));
