"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analisarMagnet = analisarMagnet;
exports.gerarUrlResolve = gerarUrlResolve;
let analisadorTorrent = null;
async function carregarAnalisador() {
    if (!analisadorTorrent) {
        const modulo = await import('parse-torrent');
        analisadorTorrent = modulo.default;
    }
    return analisadorTorrent;
}
async function analisarMagnet(magnet) {
    try {
        const analisador = await carregarAnalisador();
        const resultado = await analisador(magnet);
        if (!resultado || !resultado.infoHash)
            return null;
        return {
            infoHash: resultado.infoHash.toLowerCase(),
            nome: resultado.name || null,
            anuncios: Array.isArray(resultado.announce) ? resultado.announce : []
        };
    }
    catch {
        return null;
    }
}
async function gerarUrlResolve(magnet, chaveApi, nomeArquivo = 'video.mkv', indiceArquivo = 0, tipo, temporada, episodio, qualidade) {
    const dados = await analisarMagnet(magnet);
    if (!dados) {
        throw new Error('Nao foi possivel extrair infoHash do magnet');
    }
    const arquivoCodificado = encodeURIComponent(nomeArquivo);
    const baseUrl = process.env.BASE_URL
        || (process.env.RAILWAY_STATIC_URL
            ? `https://${process.env.RAILWAY_STATIC_URL}`
            : `http://localhost:${process.env.PORT || 7000}`);
    let url = `${baseUrl}/resolve/torbox/${chaveApi}/${dados.infoHash}/null/${indiceArquivo}/${arquivoCodificado}`;
    const parametros = new URLSearchParams();
    if (tipo)
        parametros.append('type', tipo);
    if (tipo === 'series' && temporada !== undefined) {
        parametros.append('season', temporada.toString());
        if (episodio !== undefined)
            parametros.append('episode', episodio.toString());
    }
    if (qualidade)
        parametros.append('quality', qualidade);
    const consulta = parametros.toString();
    if (consulta)
        url += `?${consulta}`;
    return url;
}
