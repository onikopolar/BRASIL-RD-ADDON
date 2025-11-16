#!/usr/bin/env ts-node

import * as dotenv from 'dotenv';
dotenv.config();

import { TorrentScraperService } from '../src/services/TorrentScraperService';

class ScrapingSearch {
    private scraper: TorrentScraperService;

    constructor() {
        this.scraper = new TorrentScraperService();
    }

    async search(query: string, type: 'movie' | 'series' = 'movie'): Promise<void> {
        console.log('Brasil RD - Busca de Torrents');
        console.log('==============================\n');
        
        console.log(`Termo de busca: "${query}"`);
        console.log(`Tipo: ${type}`);
        console.log('Iniciando busca...\n');

        const startTime = Date.now();
        
        try {
            const results = await this.scraper.searchTorrents(query, type);
            const endTime = Date.now();
            const duration = (endTime - startTime) / 1000;

            console.log(`Busca concluída em ${duration.toFixed(2)} segundos`);
            console.log(`Resultados encontrados: ${results.length}\n`);

            if (results.length > 0) {
                console.log('RESULTADOS:');
                console.log('='.repeat(100));
                
                results.forEach((result, index) => {
                    console.log(`\n${index + 1}. TITULO: ${result.title}`);
                    console.log(`   PROVIDER: ${result.provider}`);
                    console.log(`   QUALIDADE: ${result.quality}`);
                    console.log(`   TAMANHO: ${result.size}`);
                    console.log(`   IDIOMA: ${result.language}`);
                    console.log(`   SEEDERS: ${result.seeders}`);
                    console.log(`   LEECHERS: ${result.leechers}`);
                    console.log(`   MAGNET: ${result.magnet ? 'ENCONTRADO' : 'NAO ENCONTRADO'}`);
                    
                    if (result.magnet) {
                        console.log(`   LINK: ${result.magnet.substring(0, 80)}...`);
                    }
                });

                console.log('\nESTATISTICAS:');
                console.log('-'.repeat(40));
                const magnetsFound = results.filter(r => r.magnet).length;
                console.log(`Total de magnets: ${magnetsFound}/${results.length}`);
                console.log(`Taxa de sucesso: ${((magnetsFound / results.length) * 100).toFixed(1)}%`);

            } else {
                console.log('Nenhum resultado encontrado para o termo de busca.');
            }

        } catch (error) {
            console.log('ERRO NA BUSCA:', error instanceof Error ? error.message : 'Erro desconhecido');
        }
    }

    displayUsage(): void {
        console.log('Uso: npx ts-node scripts/scraping-search.ts <query> [type]');
        console.log('');
        console.log('Argumentos:');
        console.log('  query    Termo de busca (obrigatorio)');
        console.log('  type     Tipo de conteudo: movie ou series (opcional, padrao: movie)');
        console.log('');
        console.log('Exemplos:');
        console.log('  npx ts-node scripts/scraping-search.ts "avatar"');
        console.log('  npx ts-node scripts/scraping-search.ts "breaking bad" series');
        console.log('  npx ts-node scripts/scraping-search.ts "oppenheimer" movie');
    }
}

// Execucao do script
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
        const search = new ScrapingSearch();
        search.displayUsage();
        process.exit(0);
    }

    const query = args[0];
    const type = (args[1] === 'series' ? 'series' : 'movie') as 'movie' | 'series';

    const search = new ScrapingSearch();
    search.search(query, type).catch(error => {
        console.error('Erro fatal:', error);
        process.exit(1);
    });
}

export { ScrapingSearch };
