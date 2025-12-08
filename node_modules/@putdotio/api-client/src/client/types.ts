import { AxiosError, AxiosResponse } from 'axios'

export interface IPutioAPIClientOptions {
  clientID?: number
  baseURL?: string
  webAppURL?: string
}

export interface IPutioAPIClientResponse<T> extends AxiosResponse {
  data: T & { status: 'OK' }
  body?: T & { status: 'OK' } // @TODO: Remove when it's irrelevant.
}

export interface IPutioAPIClientErrorData {
  'x-trace-id'?: string
  error_id?: string
  error_uri?: string
  error_type: string
  error_message: string
  status_code: number
  extra: Record<string, unknown>
}

export interface IPutioAPIClientError
  extends AxiosError<IPutioAPIClientErrorData | string> {
  data: IPutioAPIClientErrorData
  toJSON: () => IPutioAPIClientErrorData
}

export type PutioAPIClientResponseInterceptor = {
  onFulfilled: (
    response: IPutioAPIClientResponse<any>,
  ) => IPutioAPIClientResponse<any>
  onRejected: (error: IPutioAPIClientError) => Promise<IPutioAPIClientError>
}

export type PutioAPIClientResponseInterceptorFactory = (
  options: IPutioAPIClientOptions,
) => PutioAPIClientResponseInterceptor
