// src/teste-limpar-cache.ts
import { CacheService } from './debrid/CacheService.js';

async function main() {
  const cacheService = new CacheService();
  const chave = 'resolve:torrentio:bd0123e7:b6ee27ec5a2c5ef56f8f016714ff51fcf3281cf8:0:all:all:movie';
  await cacheService.delete(chave);
  console.log('Cache de resolução limpo! Agora o TorboxService reavaliará a seleção de arquivo.');
}

main().catch(console.error);