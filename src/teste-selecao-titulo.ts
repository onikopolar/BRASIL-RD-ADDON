// src/teste-selecao-titulo.ts
import { TorboxService } from './debrid/RealDebridService.js';

async function main() {
  const service = new TorboxService();

  // Simula os títulos que o TMDB retorna para tt0145487 (Homem-Aranha 1)
  const tmdbTitles = ['homem aranha', 'spider man', 'spider-man'];

  // Simula os arquivos que o Torbox retorna para o torrent da trilogia
  const files = [
    { name: 'TRILOGIA.Homem-Aranha.1080p-RICKSZ/Homem.Aranha.1.2002.1080p.mkv', size: 3350000000 },
    { name: 'TRILOGIA.Homem-Aranha.1080p-RICKSZ/Homem.Aranha.2.2004.1080p.mkv', size: 3340000000 },
    { name: 'TRILOGIA.Homem-Aranha.1080p-RICKSZ/Homem.Aranha.3.2007.1080p.mkv', size: 3350000000 },
  ];

  console.log('🔍 Testando seleção de arquivo por título...\n');
  console.log('Títulos alvo:', tmdbTitles);
  console.log('');

  // Registra os títulos no cache do serviço (simulando o StreamHandler)
  service.setTitlesForHash('b6ee27ec5a2c5ef56f8f016714ff51fcf3281cf8', tmdbTitles);

  // Verifica se os títulos foram armazenados
  console.log('Títulos no cache:', (service as any).titleCache.get('b6ee27ec5a2c5ef56f8f016714ff51fcf3281cf8'));
  console.log('');

  // Usa a função interna de score (precisamos acessá-la)
  const calculateScore = (service as any).calculateTitleMatchScore.bind(service);

  for (const f of files) {
    const score = calculateScore(f.name, tmdbTitles);
    console.log(`📄 ${f.name}`);
    console.log(`   Score: ${score}`);
    console.log(`   Tamanho: ${(f.size / 1048576).toFixed(0)} MB`);
    console.log('');
  }
}

main().catch(console.error);