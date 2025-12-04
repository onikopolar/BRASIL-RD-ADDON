/**
 * Exceção para indicar status especiais do Real-Debrid
 * Quando lançada, o StreamHandler deve criar um stream informativo
 */

import { StaticResponse } from './StaticResponseService';

export class StreamStatusException extends Error {
  public readonly staticResponse: StaticResponse;
  public readonly rdStatus: string;
  public readonly progress?: number;

  constructor(
    staticResponse: StaticResponse,
    rdStatus: string,
    progress?: number,
    message?: string
  ) {
    super(message || `Stream status: ${staticResponse}`);
    this.name = 'StreamStatusException';
    this.staticResponse = staticResponse;
    this.rdStatus = rdStatus;
    this.progress = progress;
  }
}

export default StreamStatusException;
