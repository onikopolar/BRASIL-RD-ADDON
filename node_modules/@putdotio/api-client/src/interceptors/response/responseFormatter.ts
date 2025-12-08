import axios from 'axios'
import {
  IPutioAPIClientError,
  IPutioAPIClientErrorData,
  PutioAPIClientResponseInterceptorFactory,
} from '../../client/types'
import { isPutioAPIErrorResponse } from '../../utils'

export const createResponseFormatter: PutioAPIClientResponseInterceptorFactory = () => ({
  onFulfilled: response => ({
    ...response,
    body: response.data,
  }),

  onRejected: (error: unknown) => {
    if (!axios.isAxiosError(error)) {
      return Promise.reject(error)
    }

    try {
      let errorData: IPutioAPIClientErrorData = {
        'x-trace-id': error.response?.headers['x-trace-id'],
        error_message: error.message,
        error_type: 'ERROR',
        status_code: 0,
        extra: {},
      }

      // ECONNABORTED is the code for a request that timed out in axios.
      if (error.code === 'ECONNABORTED') {
        errorData = {
          ...errorData,
          status_code: 408,
          error_message: 'Request timed out',
        }
      }

      if (error.response && error.response.data) {
        const { status, data } = error.response
        errorData = isPutioAPIErrorResponse(data)
          ? {
              ...errorData,
              ...data,
              status_code: status,
            }
          : {
              ...errorData,
              status_code: status,
            }
      } else if (
        error.request instanceof XMLHttpRequest &&
        error.request.readyState === 4
      ) {
        const { status, responseText } = error.request
        const data = JSON.parse(responseText)

        errorData = {
          ...errorData,
          ...data,
          status_code: status,
        }
      }

      const formattedError: IPutioAPIClientError = {
        ...error,
        data: errorData,
        toJSON: () => errorData,
      }

      return Promise.reject(formattedError)
    } catch (e) {
      return Promise.reject(error)
    }
  },
})
