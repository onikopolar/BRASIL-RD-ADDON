export function convertToMobileStream(stream) {
    const magnetMatch = stream.url?.match(/btih:([a-zA-Z0-9]+)/i);
    const infoHash = magnetMatch ? magnetMatch[1] : undefined;
    const sources = stream.url?.startsWith('magnet:')
        ? [`dht:${infoHash}`]
        : [stream.url];
    return {
        title: stream.title || 'Stream',
        name: stream.name || 'Brasil RD',
        description: stream.description,
        sources: sources,
        behaviorHints: stream.behaviorHints,
        infoHash: infoHash,
        fileIdx: stream.fileIndex
    };
}
export function convertStreamsToMobile(streams) {
    return streams.map(convertToMobileStream);
}
