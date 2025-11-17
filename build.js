const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function buildTypeScript() {
    console.log('Iniciando build do TypeScript...');
    
    // Verifica se o TypeScript está instalado
    try {
        require.resolve('typescript');
        console.log('TypeScript encontrado');
    } catch (error) {
        console.log('TypeScript nao encontrado. Instalando...');
        const install = spawnSync('npm', ['install', 'typescript'], { 
            stdio: 'inherit',
            cwd: process.cwd()
        });
        if (install.status !== 0) {
            console.error('Falha ao instalar TypeScript');
            process.exit(1);
        }
    }

    // Carrega e executa o compilador TypeScript
    const ts = require('typescript');
    const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, 'tsconfig.json');

    if (!configPath) {
        console.error('tsconfig.json nao encontrado');
        process.exit(1);
    }

    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    const compilerOptions = ts.parseJsonConfigFileContent(
        configFile.config, 
        ts.sys, 
        process.cwd()
    );

    console.log('Compilando TypeScript...');
    const program = ts.createProgram(compilerOptions.fileNames, compilerOptions.options);
    const emitResult = program.emit();

    const allDiagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);

    let hasErrors = false;
    allDiagnostics.forEach(diagnostic => {
        if (diagnostic.file) {
            const { line, character } = ts.getLineAndCharacterOfPosition(diagnostic.file, diagnostic.start);
            const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
            console.log(`${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`);
        } else {
            console.log(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
        }
        
        if (diagnostic.category === ts.DiagnosticCategory.Error) {
            hasErrors = true;
        }
    });

    if (hasErrors) {
        console.error('Build falhou com erros de compilacao');
        process.exit(1);
    }

    if (emitResult.emitSkipped) {
        console.error('Build falhou - emissao de arquivos ignorada');
        process.exit(1);
    }

    console.log('Build concluido com sucesso');
}

// Remove a função copyPublicFolder e chama apenas o build do TypeScript
buildTypeScript();