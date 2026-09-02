import axios from 'axios';

(async () => {
  const url = 'https://bludvfilmes1.xyz/see-1a-temporada-torrent-web-dl-720p-1080p-dual-audio-download-2019/';
  const res = await axios.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
  const html = res.data;
  const idx = html.toLowerCase().indexOf('imdb');
  console.log('Índice de imdb:', idx);
  if (idx !== -1) {
    console.log('Trecho:', html.substring(Math.max(0, idx - 200), idx + 400));
  } else {
    console.log('Não encontrou imdb no HTML.');
  }
})();
