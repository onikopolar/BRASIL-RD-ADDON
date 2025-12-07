// Testando as regex do RealDebridService

const testCases = [
  '/The.Legend.of.Vox.Machina.S02E01.720p.WEB.h264-KOGi.mkv',
  'The.Legend.of.Vox.Machina.S02E02.720p.WEB.h264-KOGi.mkv',
  'The.Legend.of.Vox.Machina.S02E03.720p.WEB.h264-KOGi.mkv',
  'A Lenda de Vox Machina 2ª Temporada Torrent (2023) WEB-DL 720p/1080p Legendado',
  's02e03.mkv',
  'S02E03.mkv',
  'season 2 episode 3.mkv',
  '2x03.mkv'
];

function extractSeasonFromFileName(fileName) {
  const lowerName = fileName.toLowerCase();
  const patterns = [
    /s(\d+)e\d+/i,           // S03E08
    /season\s*(\d+)\s*episode/i, // Season 3 Episode 8
    /(\d+)x\d+/i             // 3x08
  ];

  for (const pattern of patterns) {
    const match = lowerName.match(pattern);
    if (match && match[1]) {
      console.log(`   ✔ Padrão: ${pattern} - Match: ${match[0]}`);
      return parseInt(match[1], 10);
    }
  }
  return undefined;
}

function extractEpisodeFromFileName(fileName) {
  const lowerName = fileName.toLowerCase();
  const patterns = [
    /s\d+e(\d+)/i,                // S03E08
    /season\s*\d+\s*episode\s*(\d+)/i, // Season 3 Episode 8
    /\d+x(\d+)/i,                 // 3x08
    /ep\s*(\d+)/i                 // Ep 08
  ];

  for (const pattern of patterns) {
    const match = lowerName.match(pattern);
    if (match && match[1]) {
      console.log(`   ✔ Padrão: ${pattern} - Match: ${match[0]}`);
      return parseInt(match[1], 10);
    }
  }
  return undefined;
}

console.log('��� TESTANDO EXTRACTION FUNCTIONS:\n');

testCases.forEach((fileName, index) => {
  console.log(`Teste ${index + 1}: "${fileName}"`);
  
  const season = extractSeasonFromFileName(fileName);
  const episode = extractEpisodeFromFileName(fileName);
  
  if (season !== undefined) {
    console.log(`   Temporada: ${season}`);
  } else {
    console.log(`   Temporada: NÃO ENCONTRADA`);
  }
  
  if (episode !== undefined) {
    console.log(`   Episódio: ${episode}`);
  } else {
    console.log(`   Episódio: NÃO ENCONTRADA`);
  }
  
  console.log('');
});
