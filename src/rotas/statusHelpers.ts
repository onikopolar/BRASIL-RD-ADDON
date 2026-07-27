export function getStatusMessage(status: string, progress: number): string {
    const messages: Record<string, string> = {
        'completed': 'Conteúdo pronto para assistir',
        'cached': 'Conteúdo em cache — pronto para assistir',
        'downloading': `Baixando... ${Math.round(progress)}% concluído`,
        'uploading': 'Fazendo seeding...',
        'stalled': 'Aguardando seeds...',
        'metaDL': 'Obtendo metadados...',
        'paused': 'Download pausado',
        'queued': 'Na fila de download',
        'error': 'Erro no processamento',
        'dead': 'Torrent sem seeds',
    };
    
    return messages[status] || `Status: ${status}`;
}
