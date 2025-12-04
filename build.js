const { spawnSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

function buildTypeScript() {
    console.log('Iniciando build do TypeScript...');
    
    // Verifica se o TypeScript está instalado
    try {
        require.resolve('typescript');
        console.log('TypeScript encontrado');
    } catch (error) {
        console.log('TypeScript não encontrado. Instalando...');
        const install = spawnSync('npm', ['install', 'typescript'], { 
            stdio: 'inherit',
            cwd: process.cwd()
        });
        if (install.status !== 0) {
            console.error('Falha ao instalar TypeScript');
            process.exit(1);
        }
    }

    // Instalar fs-extra se não estiver instalado
    try {
        require.resolve('fs-extra');
    } catch (error) {
        console.log('Instalando fs-extra para copiar arquivos...');
        const installFsExtra = spawnSync('npm', ['install', 'fs-extra'], {
            stdio: 'inherit',
            cwd: process.cwd()
        });
        if (installFsExtra.status !== 0) {
            console.error('Falha ao instalar fs-extra');
            process.exit(1);
        }
    }

    const fsExtra = require('fs-extra');
    const ts = require('typescript');

    // 1. Copiar pasta de vídeos ANTES de compilar
    console.log('Copiando vídeos informativos...');
    const videosSource = path.join(__dirname, 'src', 'videos');
    const videosDest = path.join(__dirname, 'dist', 'videos');
    
    if (fs.existsSync(videosSource)) {
        try {
            fsExtra.copySync(videosSource, videosDest);
            console.log(`Vídeos copiados: ${videosSource} -> ${videosDest}`);
            
            // Listar vídeos copiados
            const videoFiles = fs.readdirSync(videosSource);
            console.log(`Vídeos encontrados: ${videoFiles.length}`);
            videoFiles.forEach(file => {
                if (file.endsWith('.mp4')) {
                    console.log(`  - ${file}`);
                }
            });
        } catch (error) {
            console.error(`Erro ao copiar vídeos: ${error.message}`);
        }
    } else {
        console.warn(`Pasta de vídeos não encontrada: ${videosSource}`);
    }

    // 2. Garantir que a pasta dist existe
    const distPath = path.join(__dirname, 'dist');
    if (!fs.existsSync(distPath)) {
        fs.mkdirSync(distPath, { recursive: true });
        console.log(`Pasta criada: ${distPath}`);
    }

    // 3. Compilar TypeScript
    const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, 'tsconfig.json');

    if (!configPath) {
        console.error('tsconfig.json não encontrado');
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
        console.error('Build falhou com erros de compilação');
        process.exit(1);
    }

    if (emitResult.emitSkipped) {
        console.error('Build falhou - emissão de arquivos ignorada');
        process.exit(1);
    }

    // 4. Verificar se os arquivos foram compilados
    console.log('Verificando arquivos compilados...');
    const requiredFiles = [
        'dist/server.js',
        'dist/services/StreamHandler.js',
        'dist/utils/logger.js',
        'dist/types/index.js',
        'dist/services/StaticResponseService.js'
    ];

    let missingFiles = [];
    for (const file of requiredFiles) {
        if (!fs.existsSync(file)) {
            missingFiles.push(file);
        }
    }

    if (missingFiles.length > 0) {
        console.error('Arquivos compilados faltando:');
        missingFiles.forEach(file => console.error(`- ${file}`));
        console.error('Build incompleto - alguns arquivos não foram gerados');
        process.exit(1);
    }

    // 5. Verificar se vídeos foram copiados
    if (fs.existsSync(videosDest)) {
        const copiedVideos = fs.readdirSync(videosDest);
        console.log(`Vídeos disponíveis em dist/videos/: ${copiedVideos.length} arquivos`);
        copiedVideos.forEach(file => {
            const filePath = path.join(videosDest, file);
            const stats = fs.statSync(filePath);
            console.log(`  - ${file} (${Math.round(stats.size / 1024)} KB)`);
        });
    } else {
        console.warn('Pasta dist/videos/ não foi criada');
    }

    console.log('\nBuild concluído com sucesso!');
    console.log('Arquivos compilados disponíveis em: dist/');
    console.log('Vídeos disponíveis em: /videos/');
}

buildTypeScript();