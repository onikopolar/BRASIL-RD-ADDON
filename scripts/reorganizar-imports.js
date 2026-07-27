const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Mapa de substituicao: [padraoAntigo, padraoNovo]
const substituicoes = [
  // rotas
  ['../arquivos-serverts/', '../rotas/'],
  ['./arquivos-serverts/', './rotas/'],
  ['arquivos-serverts/', 'rotas/'],
  
  // titulos
  ['../lib/title-filter/', '../titulos/'],
  ['./lib/title-filter/', './titulos/'],
  ['lib/title-filter/', 'titulos/'],
  ['../lib/titleFilter', '../titulos/titleFilter'],
  ['./lib/titleFilter', './titulos/titleFilter'],
  ['../lib/episodeMatcher', '../titulos/episodeMatcher'],
  ['./lib/episodeMatcher', './titulos/episodeMatcher'],
  
  // stream
  ['../lib/streamFormatter', '../stream/streamFormatter'],
  ['./lib/streamFormatter', './stream/streamFormatter'],
  ['../services/StreamHandler', '../stream/StreamHandler'],
  ['./services/StreamHandler', './stream/StreamHandler'],
  ['../services/StaticResponseService', '../stream/StaticResponseService'],
  ['./services/StaticResponseService', './stream/StaticResponseService'],
  ['../services/StreamStatusException', '../stream/StreamStatusException'],
  ['./services/StreamStatusException', './stream/StreamStatusException'],
  
  // magnet
  ['../lib/magnetHelper', '../magnet/magnetHelper'],
  ['./lib/magnetHelper', './magnet/magnetHelper'],
  ['lib/magnetHelper', 'magnet/magnetHelper'],
  
  // debrid
  ['../services/RealDebridService', '../debrid/RealDebridService'],
  ['./services/RealDebridService', './debrid/RealDebridService'],
  ['../services/AutoMagnetService', '../debrid/AutoMagnetService'],
  ['./services/AutoMagnetService', './debrid/AutoMagnetService'],
  ['../services/RdTorrentCacheService', '../debrid/RdTorrentCacheService'],
  ['./services/RdTorrentCacheService', './debrid/RdTorrentCacheService'],
  ['../services/CacheService', '../debrid/CacheService'],
  ['./services/CacheService', './debrid/CacheService'],
  ['../services/AdvancedCacheService', '../debrid/AdvancedCacheService'],
  ['./services/AdvancedCacheService', './debrid/AdvancedCacheService'],
  
  // catalogo
  ['../providers/catalogProvider', '../catalogo/catalogProvider'],
  ['./providers/catalogProvider', './catalogo/catalogProvider'],
  ['../services/CuratedMagnetService', '../catalogo/CuratedMagnetService'],
  ['./services/CuratedMagnetService', './catalogo/CuratedMagnetService'],
  ['../services/ImdbScraperService', '../catalogo/ImdbScraperService'],
  ['./services/ImdbScraperService', './catalogo/ImdbScraperService'],
  ['../services/TorrentioService', '../catalogo/TorrentioService'],
  ['./services/TorrentioService', './catalogo/TorrentioService'],
  ['../services/MetricsService', '../catalogo/MetricsService'],
  ['./services/MetricsService', './catalogo/MetricsService'],
];

// Encontra todos os arquivos .ts em src/
function encontrarArquivosTs(dir) {
  const resultados = [];
  const entradas = fs.readdirSync(dir, { withFileTypes: true });
  for (const entrada of entradas) {
    const caminhoCompleto = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      resultados.push(...encontrarArquivosTs(caminhoCompleto));
    } else if (entrada.name.endsWith('.ts')) {
      resultados.push(caminhoCompleto);
    }
  }
  return resultados;
}

const arquivos = encontrarArquivosTs('src');
let totalSubstituicoes = 0;

for (const arquivo of arquivos) {
  let conteudo = fs.readFileSync(arquivo, 'utf8');
  let modificado = false;
  
  for (const [antigo, novo] of substituicoes) {
    if (conteudo.includes(antigo)) {
      conteudo = conteudo.split(antigo).join(novo);
      modificado = true;
      totalSubstituicoes++;
    }
  }
  
  if (modificado) {
    fs.writeFileSync(arquivo, conteudo);
    console.log(`ATUALIZADO: ${arquivo}`);
  }
}

console.log(`\nTotal de substituicoes: ${totalSubstituicoes}`);
