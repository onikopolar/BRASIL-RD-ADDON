const {SimilarityCalculator} = require('../dist/titulos/SimilarityCalculator.js');
const calc = new SimilarityCalculator();

(async () => {
  // Deve ACEITAR: "and" é cola
  let r = await calc.smartTitleContainsCheck('Rick.Morty.S05E01.1080p.WEB-DL', 'tt2861424');
  console.log('Rick.Morty:', r.matches ? '✅ ACEITO' : '❌ REJEITADO', r.reason);

  // Deve REJEITAR: "Poltergeist" não tem palavras de Jurassic Park
  r = await calc.smartTitleContainsCheck('Poltergeist - O Fenomeno DVDrip Dual Audio', 'tt0107290');
  console.log('Poltergeist:', r.matches ? '❌ ACEITO (BUG!)' : '✅ REJEITADO', r.reason);

  // Deve REJEITAR: "Rambo" também não
  r = await calc.smartTitleContainsCheck('Rambo 1 DVDRip RMVB Dublado', 'tt0107290');
  console.log('Rambo:', r.matches ? '❌ ACEITO (BUG!)' : '✅ REJEITADO', r.reason);

  // Deve ACEITAR: Jurassic Park correto
  r = await calc.smartTitleContainsCheck('Jurassic Park (1993) BluRay 1080p Dublado', 'tt0107290');
  console.log('Jurassic Park:', r.matches ? '✅ ACEITO' : '❌ REJEITADO', r.reason);
})();
