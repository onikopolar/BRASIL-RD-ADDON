const { MetadataExtractor } = require('./dist/lib/title-filter/MetadataExtractor');

const extractor = new MetadataExtractor();

const testTitles = [
  'The Witcher S01E01 1080p Dual Áudio',
  'Stranger Things Temporada 3 Completa 1080p',
  'Breaking Bad S05E14 720p Legendado',
  'Game of Thrones 4x05 1080p Dublado',
  'La Casa de Papel Temporada 1 WEB-DL 1080p',
  'The Mandalorian S02E03 4K HDR',
  'Friends Season 10 Episode 17 720p',
  'The Boys S03 1080p Dual' // Temporada completa sem episódio específico
];

console.log('=== TESTE METADATA EXTRACTOR ===\n');

testTitles.forEach(title => {
  const metadata = extractor.extractBasicMetadata(title);
  const enhanced = extractor.extractEnhancedMetadata(title);
  
  console.log(`Título: "${title}"`);
  console.log(`  Media Type: ${metadata.mediaType}`);
  console.log(`  Season: ${metadata.season || 'N/A'}`);
  console.log(`  Episode: ${metadata.episode || 'N/A'}`);
  console.log(`  Complete Season: ${metadata.isCompleteSeason}`);
  console.log(`  Is Package: ${metadata.isPackage}`);
  console.log(`  Detected as Series: ${metadata.mediaType === 'series'}`);
  console.log('---');
});
