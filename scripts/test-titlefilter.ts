//A gente vai importar as variaveis necessarias pra poder funcionar algumas coisas no script
import 'dotenv/config';
console.log('TMDB_API_KEY:', process.env.TMDB_API_KEY ? 'Carregada' : 'NÃO ENCONTRADA');

//importar a classe TitleFilter que é onde faz o serviço geral do codigo
import { TitleFilter } from '../src/lib/titleFilter';

async function testarSimilaridade() {
    //pega a instancia unica (singelton) do titlefilter
    const tf = TitleFilter.getInstance();

    // Aqui a gente vai criar parametros personalizados
    const torrentTitle = 'Avatar: A Lenda de Aang'
    const imdbId = 'tt0967584';
    const temporada = undefined;
    const episodio = undefined;

    console.log(`Teste da similaridade:
        Titulo do torrent: ${torrentTitle}
        imdb id: ${imdbId}
        Temporada alvo ${temporada ?? "Não definida"}
        Episodio alvo: ${episodio ?? "Não definido"}`
    )


    try {
        //Chama o metodo do teste (assyncrono porque busca titulos no tmdb)
        const resultado = await tf.testTitleMatch(torrentTitle, imdbId, temporada, episodio);

        console.log(`Resultado da comparação: `);
        console.log(` Matches: ${resultado.matches}`);
        console.log(` Similarity: ${(resultado.similarity * 100).toFixed(1)}%`);
        console.log(` Reason: ${resultado.reason}`);
        if (resultado.matchedTitle) {
            console.log(`  título TMDB usado: "${resultado.matchedTitle}" (${resultado.matchedLanguage})`);
        }
        if (resultado.torrentMetadata) {
            const m = resultado.torrentMetadata;
            if (m.season !== undefined) console.log(`  temporada detectada: ${m.season}`);
            if (m.episode !== undefined) console.log(`  episódio detectado: ${m.episode}`);
        }
        if (!resultado.matchedTitle) {
            console.log('⚠️  Nenhum título encontrado no TMDB.');
            console.log('    Isso pode acontecer se:');
            console.log('    - O IMDb ID for de um episódio (use o ID da série).');
            console.log('    - O filme/série não existir no TMDB.');
            console.log('    - A chave TMDB_API_KEY estiver inválida.');
        }
        console.log(`\n✅ O título "${torrentTitle}" ${resultado.matches ? 'PASSOU no filtro' : 'NÃO passou no filtro'}`);

    } catch (erro) {
        console.error('Erro ao testar similaridade:', erro);
    }
}

testarSimilaridade();