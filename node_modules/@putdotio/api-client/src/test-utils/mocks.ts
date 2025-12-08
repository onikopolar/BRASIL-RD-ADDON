import { AxiosError, AxiosRequestConfig } from 'axios'
import {
  IPutioAPIClientError,
  IPutioAPIClientErrorData,
  IPutioAPIClientResponse,
} from '../client/types'

const mockRequestConfig: AxiosRequestConfig = {}

export const mockPutioAPIClientResponse: IPutioAPIClientResponse<{
  foo: string
}> = {
  config: mockRequestConfig,
  data: { foo: 'bar', status: 'OK' },
  headers: {
    'x-trace-id': 'MOCK_TRACE_ID',
  },
  status: 200,
  statusText: 'ok',
}

export const mockAxiosError: AxiosError = {
  config: mockRequestConfig,
  isAxiosError: true,
  name: 'AXIOS_ERROR',
  message: 'AXIOS_ERROR_MESSAGE',
  toJSON() {
    return {
      name: this.name,
      message: this.message,
    }
  },
}

export const mockPutioAPIClientError: IPutioAPIClientError = {
  ...mockAxiosError,
  data: {
    error_type: 'MOCK_ERROR',
    error_message: 'MOCK_MESSAGE',
    status_code: 0,
    extra: { foo: 'bar' },
  },
  toJSON() {
    return this.data
  },
}

export const createMockResponse = <T>(
  data: T,
  status: number = 200,
): IPutioAPIClientResponse<T> => ({
  config: mockRequestConfig,
  data: { ...data, status: 'OK' },
  status,
  headers: {},
  statusText: 'ok',
})

export const createMockErrorResponse = (
  data: IPutioAPIClientErrorData,
): IPutioAPIClientError => ({
  ...mockAxiosError,
  data,
  toJSON() {
    return this.data
  },
})

export function createMockXMLHttpRequest(
  readyState: number,
  status: number,
  responseText: string,
) {
  const xhr = new XMLHttpRequest()
  return new Proxy(xhr, {
    get(target, prop) {
      if (prop === 'readyState') return readyState
      if (prop === 'status') return status
      if (prop === 'responseText') return responseText
      // @ts-ignore
      return target[prop]
    },
  })
}
