import { IPutioAPIClientError, IPutioAPIClientErrorData } from '../client/types'

export const identity = <T>(arg: T) => arg

export const isPutioAPIErrorResponse = (
  input: unknown,
): input is IPutioAPIClientErrorData =>
  typeof input === 'object' &&
  !!input &&
  !!(input as Record<string, unknown>).error_type

export const isPutioAPIError = (
  input: unknown,
): input is IPutioAPIClientError =>
  typeof input === 'object' &&
  !!input &&
  !!(input as Record<string, unknown>).data &&
  isPutioAPIErrorResponse((input as Record<string, unknown>).data)

export const createFormDataFromObject = (obj: Record<string, unknown>) => {
  return Object.keys(obj).reduce((data, key) => {
    data.append(key, obj[key] as string | Blob)
    return data
  }, new FormData())
}
