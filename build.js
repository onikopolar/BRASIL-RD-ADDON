import { spawnSync } from 'child_process';

console.log('Iniciando build do TypeScript...');

// Compilar TypeScript
const result = spawnSync('npx', ['tsc'], { 
    stdio: 'inherit',
    shell: true  // ← ADICIONE ESTA LINHA
});

// Verificar manualmente se a compilação foi bem-sucedida
const fs = await import('fs');
if (fs.existsSync('dist/server.js')) {
    console.log('Build concluido com sucesso');
    console.log('Arquivos compilados disponiveis em: dist/');
} else {
    console.error('Build falhou - arquivo dist/server.js não foi gerado');
    process.exit(1);
}