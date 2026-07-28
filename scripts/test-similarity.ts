const { SimilarityCalculator } = require('../dist/titulos/SimilarityCalculator.js');

const sim = SimilarityCalculator.getInstance();

const titulos = [
  'A.Escolha.Perfeita.2.2015.1080p.Dual-WOLVERDONFILMES.COM',
  'A Escolha Perfeita 2 (2015) 5.1 CH Dublado 1080p (By-LuanHar',
  'A Escolha Perfeita [2012]-BluRay 1080p Dual Áudio',
  'A Escolha Perfeita 3 2018 [1080p] WWW.BLUDV.COM',
  'A Escolha Perfeita 2016 [1080p] WWW.BLUDV.COM',
];

for (const t of titulos) {
  const norm = sim.normalizarParaComparacao(t);
  console.log('ORIGINAL:', t.substring(0, 80));
  console.log('NORM:    ', norm);
  const palavras = norm.split(' ').filter(w => w.length > 0);
  const palavrasSemNumeros = palavras.filter(w => !(/^\d+$/.test(w)));
  console.log('PALAVRAS:', palavras.join(' | '));
  console.log('SEM NUM: ', palavrasSemNumeros.join(' | '));
  console.log('---');
}
