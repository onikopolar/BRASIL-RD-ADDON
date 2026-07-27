/**
 * Exceção para indicar status especiais do Torbox
 * Quando lançada, o StreamHandler deve criar um stream informativo
 */

import { StaticResponse } from './StaticResponseService.js';

export class StreamStatusException extends Error {
  public readonly staticResponse: StaticResponse;
  public readonly serviceStatus: string;
  public readonly progress?: number;

  constructor(
    staticResponse: StaticResponse,
    serviceStatus: string,
    progress?: number,
    message?: string
  ) {
    super(message || `Stream status: ${staticResponse}`);
    this.name = 'StreamStatusException';
    this.staticResponse = staticResponse;
    this.serviceStatus = serviceStatus;
    this.progress = progress;
  }
}

export default StreamStatusException;
