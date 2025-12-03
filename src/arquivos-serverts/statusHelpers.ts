export function getStatusMessage(status: string, progress: number): string {
    const messages: Record<string, string> = {
        'downloaded': 'Conteúdo pronto para assistir',
        'downloading': `Baixando... ${Math.round(progress)}% concluído`,
        'queued': 'Na fila de download',
        'magnet_conversion': 'Convertendo magnet...',
        'uploading': 'Fazendo upload...',
        'compressing': 'Comprimindo arquivos...',
        'error': 'Erro no processamento',
        'dead': 'Torrent sem seeds',
        'virus': 'Arquivo infectado detectado'
    };
    
    return messages[status] || `Status: ${status}`;
}
