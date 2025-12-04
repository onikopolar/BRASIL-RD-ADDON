/**
 * Serviço para criar streams informativos (ao invés de vídeos)
 * Mensagens curtas e diretas em português BR
 * Agora com URLs absolutas de vídeo para o Stremio
 */

import { Logger } from '../utils/logger';

export enum StaticResponse {
  DOWNLOADING = 'downloading',
  FAILED_DOWNLOAD = 'failed_download',
  FAILED_ACCESS = 'failed_access',
  FAILED_RAR = 'failed_rar',
  FAILED_TOO_BIG = 'failed_too_big',
  FAILED_OPENING = 'failed_opening',
  FAILED_UNEXPECTED = 'failed_unexpected',
  FAILED_INFRINGEMENT = 'failed_infringement',
  LIMITS_EXCEEDED = 'limits_exceeded',
  BLOCKED_ACCESS = 'blocked_access'
}

export interface StaticResponseInfo {
  name: string;
  title: string;
  description: string;
  url: string;
  videoUrl: string;
}

export class StaticResponseService {
  private readonly logger: Logger;
  private baseUrl: string;
  
  constructor(baseUrl?: string) {
    this.logger = new Logger('StaticResponseService');
    // URL base absoluta para o Stremio - usa a lógica do serverFunctions.ts
    this.baseUrl = baseUrl || this.getBaseUrl();
  }

  /**
   * Determina a URL base dinamicamente, seguindo a mesma lógica do serverFunctions.ts
   */
  private getBaseUrl(): string {
    // Primeiro verifica se há uma URL base fornecida por variável de ambiente
    if (process.env.BASE_URL) {
      return process.env.BASE_URL;
    }

    // Verifica RAILWAY_STATIC_URL (usado no Railway)
    if (process.env.RAILWAY_STATIC_URL) {
      const railwayUrl = process.env.RAILWAY_STATIC_URL;
      if (railwayUrl.startsWith('http')) {
        return railwayUrl;
      }
      return `https://${railwayUrl}`;
    }

    // Para desenvolvimento local
    const port = process.env.PORT ? parseInt(process.env.PORT) : 7000;
    return `http://localhost:${port}`;
  }

  /**
   * Atualiza a URL base (útil quando o serviço é criado antes do servidor iniciar)
   */
  public setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl;
    this.logger.info('URL base atualizada', { baseUrl });
  }

  /**
   * Obtém informações para uma resposta estática
   * Agora com URLs de vídeo absolutas para o Stremio
   */
  getResponseInfo(response: StaticResponse): StaticResponseInfo {
    // Mapear respostas estáticas para arquivos de vídeo
    const videoFileMap: Record<StaticResponse, string> = {
      [StaticResponse.DOWNLOADING]: 'downloading_v2.mp4',
      [StaticResponse.FAILED_DOWNLOAD]: 'download_failed_v2.mp4',
      [StaticResponse.FAILED_ACCESS]: 'failed_access_v2.mp4',
      [StaticResponse.FAILED_RAR]: 'failed_rar_v2.mp4',
      [StaticResponse.FAILED_TOO_BIG]: 'failed_too_big_v1.mp4',
      [StaticResponse.FAILED_OPENING]: 'failed_opening_v2.mp4',
      [StaticResponse.FAILED_UNEXPECTED]: 'failed_unexpected_v2.mp4',
      [StaticResponse.FAILED_INFRINGEMENT]: 'failed_infringement_v2.mp4',
      [StaticResponse.LIMITS_EXCEEDED]: 'limits_exceeded_v1.mp4',
      [StaticResponse.BLOCKED_ACCESS]: 'blocked_access_v1.mp4'
    };

    // URL absoluta para o Stremio
    const videoFileName = videoFileMap[response];
    const videoUrl = videoFileName ? `${this.baseUrl}/videos/${videoFileName}` : `${this.baseUrl}/videos/downloading_v2.mp4`;
    
    const responses: Record<StaticResponse, StaticResponseInfo> = {
      [StaticResponse.DOWNLOADING]: {
        name: 'Baixando',
        title: 'Brasil RD - Baixando',
        description: 'Torrent sendo baixado pelo Real-Debrid\nAguarde 1-10 minutos',
        url: videoUrl,
        videoUrl: videoUrl
      },
      [StaticResponse.FAILED_DOWNLOAD]: {
        name: 'Download falhou',
        title: 'Brasil RD - Falhou',
        description: 'Falha ao baixar torrent\nTente outro magnet link',
        url: videoUrl,
        videoUrl: videoUrl
      },
      [StaticResponse.FAILED_ACCESS]: {
        name: 'Chave API inválida',
        title: 'Brasil RD - API inválida',
        description: 'Chave do Real-Debrid inválida\nObtenha nova chave em real-debrid.com/apitoken',
        url: videoUrl,
        videoUrl: videoUrl
      },
      [StaticResponse.FAILED_RAR]: {
        name: 'Arquivo RAR',
        title: 'Brasil RD - RAR/ZIP',
        description: 'Contém arquivos compactados\nAguarde extração ou tente outro',
        url: videoUrl,
        videoUrl: videoUrl
      },
      [StaticResponse.FAILED_TOO_BIG]: {
        name: 'Muito grande',
        title: 'Brasil RD - Grande demais',
        description: 'Torrent excede limite do Real-Debrid\nTente versão menor',
        url: videoUrl,
        videoUrl: videoUrl
      },
      [StaticResponse.FAILED_OPENING]: {
        name: 'Erro no magnet',
        title: 'Brasil RD - Magnet inválido',
        description: 'Não conseguiu processar magnet link\nVerifique o link',
        url: videoUrl,
        videoUrl: videoUrl
      },
      [StaticResponse.FAILED_UNEXPECTED]: {
        name: 'Erro inesperado',
        title: 'Brasil RD - Erro',
        description: 'Ocorreu um erro inesperado\nTente novamente',
        url: videoUrl,
        videoUrl: videoUrl
      },
      [StaticResponse.FAILED_INFRINGEMENT]: {
        name: 'Bloqueado',
        title: 'Brasil RD - Bloqueado',
        description: 'Conteúdo removido por direitos autorais\nTente outra fonte',
        url: videoUrl,
        videoUrl: videoUrl
      },
      [StaticResponse.LIMITS_EXCEEDED]: {
        name: 'Limites excedidos',
        title: 'Brasil RD - Limites',
        description: 'Limites do Real-Debrid excedidos\nAguarde ou faça upgrade',
        url: videoUrl,
        videoUrl: videoUrl
      },
      [StaticResponse.BLOCKED_ACCESS]: {
        name: 'Acesso bloqueado',
        title: 'Brasil RD - Acesso bloqueado',
        description: 'Acesso ao Real-Debrid bloqueado\nVerifique sua conta',
        url: videoUrl,
        videoUrl: videoUrl
      }
    };

    return responses[response];
  }

  /**
   * Cria um stream informativo para o Stremio
   * Agora com URL de vídeo absoluta para reprodução
   */
  createInformativeStream(response: StaticResponse, requestId?: string): any {
    const info = this.getResponseInfo(response);
    
    const stream = {
      title: info.title,
      name: `Brasil RD - ${info.name}`,
      description: `${info.description}${requestId ? `\nID: ${requestId}` : ''}`,
      url: info.url,
      behaviorHints: {
        notWebReady: true
      }
    };

    this.logger.info(`Stream informativo criado: ${info.name}`, { 
      requestId,
      videoUrl: info.url,
      baseUrl: this.baseUrl,
      notWebReady: stream.behaviorHints.notWebReady 
    });
    return stream;
  }

  /**
   * Cria um stream informativo com status do Real-Debrid
   */
  createInformativeStreamWithStatus(
    response: StaticResponse, 
    rdStatus?: string, 
    progress?: number,
    requestId?: string
  ): any {
    const info = this.getResponseInfo(response);
    
    let description = info.description;
    if (rdStatus) {
      description += `\nStatus Real-Debrid: ${rdStatus}`;
    }
    if (progress !== undefined) {
      description += `\nProgresso: ${progress}%`;
    }
    if (requestId) {
      description += `\nID: ${requestId}`;
    }
    
    const stream = {
      title: info.title,
      name: `Brasil RD - ${info.name}`,
      description: description,
      url: info.url,
      behaviorHints: {
        notWebReady: true
      }
    };

    this.logger.info(`Stream informativo com status criado: ${info.name}`, { 
      requestId,
      rdStatus,
      progress,
      videoUrl: info.url,
      baseUrl: this.baseUrl
    });
    return stream;
  }

  /**
   * Determina a resposta estática apropriada baseada no status do Real-Debrid
   */
  getResponseForRealDebridStatus(rdStatus: string, errorCode?: number): StaticResponse | null {
    if (errorCode !== undefined) {
      const errorMap: Record<number, StaticResponse> = {
        8: StaticResponse.FAILED_ACCESS,
        9: StaticResponse.FAILED_ACCESS,
        20: StaticResponse.FAILED_ACCESS,
        21: StaticResponse.LIMITS_EXCEEDED,
        23: StaticResponse.LIMITS_EXCEEDED,
        26: StaticResponse.LIMITS_EXCEEDED,
        29: StaticResponse.FAILED_TOO_BIG,
        35: StaticResponse.FAILED_INFRINGEMENT,
        36: StaticResponse.LIMITS_EXCEEDED
      };

      if (errorMap[errorCode]) {
        return errorMap[errorCode];
      }
    }

    const statusMap: Record<string, StaticResponse> = {
      'downloading': StaticResponse.DOWNLOADING,
      'uploading': StaticResponse.DOWNLOADING,
      'queued': StaticResponse.DOWNLOADING,
      'magnet_conversion': StaticResponse.DOWNLOADING,
      'waiting_files_selection': StaticResponse.DOWNLOADING,
      'error': StaticResponse.FAILED_DOWNLOAD,
      'magnet_error': StaticResponse.FAILED_OPENING,
      'dead': StaticResponse.FAILED_DOWNLOAD
    };

    return statusMap[rdStatus] || null;
  }

  /**
   * Verifica se um objeto de stream é informativo
   */
  isInformativeStream(stream: any): boolean {
    if (!stream?.url) return false;
    
    const url = stream.url.toLowerCase();
    return (
      url.includes(`${this.baseUrl}/videos/`) ||
      url.includes('downloading_v2.mp4') ||
      url.includes('download_failed_v2.mp4') ||
      url.includes('failed_access_v2.mp4')
    );
  }

  /**
   * Obtém a URL do vídeo para uma resposta estática
   */
  getVideoUrlForResponse(response: StaticResponse): string {
    const info = this.getResponseInfo(response);
    return info.url;
  }

  /**
   * Lista todas as respostas disponíveis com seus vídeos
   */
  listAllResponses(): Array<{response: StaticResponse, name: string, videoUrl: string}> {
    return Object.values(StaticResponse).map(response => {
      const info = this.getResponseInfo(response);
      return {
        response,
        name: info.name,
        videoUrl: info.url
      };
    });
  }
}

export default StaticResponseService;