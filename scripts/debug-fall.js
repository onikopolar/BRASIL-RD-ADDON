// Debug: por que Battlefield.Fall.Of.The.World passa no A?
const { isTechnicalWord } = require('../dist/titulos/TechnicalWords.js');

const tokenizar = (txt) => txt.toLowerCase()
  .replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()
  .split(' ').filter(w => w.length > 0 && !/^\d+$/.test(w));

// LCS
function calcularLCS(a, b) {
  const m = a.length, n = b.length;
  let prev = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    const curr = new Array(n + 1).fill(0);
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    prev = curr;
  }
  return prev[n];
}

function palavrasParecidas(a, b) {
  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return false;
  const lcs = calcularLCS(a, b);
  const minLen = Math.min(a.length, b.length);
  return lcs >= 3 && lcs / minLen >= 0.75;
}

const torrent = 'Battlefield.Fall.Of.The.World.2022.1080p.BluRay.Dublado.mkv';
const palavrasTorrent = tokenizar(torrent);
const tmdbWords = ['fall']; // palavrasTitulo

console.log('Torrent words:', palavrasTorrent);
console.log('TMDB words:', tmdbWords);
console.log('');

// TMDB → Torrent
let enc = 0;
const falt = [];
for (const pt of tmdbWords) {
  const match = palavrasTorrent.some(p => palavrasParecidas(pt, p));
  console.log(`  TMDB "${pt}":`, match ? '✅ match' : '❌ falta');
  if (match) enc++; else falt.push(pt);
}

// Torrent → TMDB extras
let extras = 0;
for (const pt of palavrasTorrent) {
  if (isTechnicalWord(pt)) continue;
  if (tmdbWords.some(t => palavrasParecidas(pt, t))) continue;
  console.log(`  EXTRA: "${pt}" (len=${pt.length})`);
  extras++;
}

const totalTorrent = palavrasTorrent.filter(w => !isTechnicalWord(w)).length || 1;
const proporcao = (enc + (totalTorrent - extras)) / (tmdbWords.length + totalTorrent);

console.log('');
console.log('enc:', enc, 'falt:', falt);
console.log('extras:', extras, 'totalTorrent:', totalTorrent);
console.log('proporcao:', proporcao.toFixed(2), (proporcao >= 0.6 ? '✅ PASSA' : '❌ FALHA'));
console.log('anoExato → maxExtras=4, extras=' + extras + ' ≤ 4:', extras <= 4);
