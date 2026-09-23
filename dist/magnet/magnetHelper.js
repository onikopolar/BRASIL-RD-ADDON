"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analisarMagnet = analisarMagnet;
exports.gerarUrlResolve = gerarUrlResolve;
const logger_js_1 = require("../utils/logger.js");
let analisadorTorrent = null;
const logger = new logger_js_1.Logger('MagnetHelper');
async function carregarAnalisador() {
    if (!analisadorTorrent) {
        const modulo = await import('parse-torrent');
        analisadorTorrent = modulo.default;
    }
    return analisadorTorrent;
}
function decodeHtmlEntities(text) {
    const cheerio = require('cheerio');
    return cheerio.load(`<span>${text}</span>`)('span').text();
}
async function analisarMagnet(magnet) {
    try {
        const analisador = await carregarAnalisador();
        const resultado = await analisador(magnet);
        if (!resultado || !resultado.infoHash)
            return null;
        return {
            infoHash: resultado.infoHash.toLowerCase(),
            nome: resultado.name ? decodeHtmlEntities(resultado.name) : null,
            anuncios: Array.isArray(resultado.announce) ? resultado.announce : []
        };
    }
    catch {
        return null;
    }
}
async function gerarUrlResolve(magnet, chaveApi, nomeArquivo = 'video.mkv', indiceArquivo = 0, tipo, temporada, episodio, qualidade, infoHashPreParsed, titles, imdbId) {
    const infoHash = infoHashPreParsed || (await analisarMagnet(magnet))?.infoHash;
    if (!infoHash) {
        throw new Error('Nao foi possivel extrair infoHash do magnet');
    }
    const arquivoCodificado = encodeURIComponent(nomeArquivo);
    const baseUrl = process.env.BASE_URL
        || (process.env.RAILWAY_STATIC_URL
            ? `https://${process.env.RAILWAY_STATIC_URL}`
            : `http://localhost:${process.env.PORT || 7000}`);
    const seasonEpisodePath = tipo === 'series' && temporada !== undefined && episodio !== undefined
        ? `s${temporada}e${episodio}`
        : (tipo === 'movie' ? 'movie' : 'null');
    let url = `${baseUrl}/resolve/torbox/${chaveApi}/${infoHash}/${seasonEpisodePath}/${indiceArquivo}/${arquivoCodificado}`;
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
    if (imdbId)
        parametros.append('imdbId', imdbId);
    if (titles && titles.length > 0) {
        parametros.append('titles', titles.join(','));
    }
    parametros.append('magnet', magnet);
    const consulta = parametros.toString();
    logger.debug('GERAR_URL_RESOLVE', { tipo, temporada, episodio, qualidade, imdbId, infoHash });
    if (consulta)
        url += `?${consulta}`;
    return url;
}
