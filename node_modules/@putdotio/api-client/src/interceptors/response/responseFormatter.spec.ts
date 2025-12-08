import {
  mockPutioAPIClientError,
  mockPutioAPIClientResponse,
  createMockXMLHttpRequest,
  mockAxiosError,
} from '../../test-utils/mocks'
import { IPutioAPIClientError } from '../../client/types'
import { DEFAULT_CLIENT_OPTIONS } from '../../constants'
import { createResponseFormatter } from './responseFormatter'

describe('interceptors/response/responseFormatter', () => {
  const responseFormatter = createResponseFormatter(DEFAULT_CLIENT_OPTIONS)

  describe('successful responses', () => {
    it('transforms as expected', () => {
      expect(responseFormatter.onFulfilled(mockPutioAPIClientResponse))
        .toMatchInlineSnapshot(`
        Object {
          "body": Object {
            "foo": "bar",
            "status": "OK",
          },
          "config": Object {},
          "data": Object {
            "foo": "bar",
            "status": "OK",
          },
          "headers": Object {
            "x-trace-id": "MOCK_TRACE_ID",
          },
          "status": 200,
          "statusText": "ok",
        }
      `)
    })
  })

  describe('failed responses', () => {
    it('sets error.data property correctly when the request failed with client timeout error', () => {
      const mockAxiosErrorWithTimeout = {
        ...mockAxiosError,
        code: 'ECONNABORTED',
      }

      const mockPutioAPIClientErrorWithTimeout = {
        ...mockAxiosErrorWithTimeout,
        ...mockPutioAPIClientError,
      }

      const error = {
        ...mockPutioAPIClientErrorWithTimeout,
        response: undefined,
        request: undefined,
        config: {},
      }

      responseFormatter.onRejected(error).catch(e => {
        expect(e).toMatchInlineSnapshot(`
          Object {
            "error_message": "Request timed out",
            "error_type": "ERROR",
            "extra": Object {},
            "status_code": 408,
            "x-trace-id": undefined,
          }
        `)
      })
    })

    it('sets error.data property correctly when the request failed with put.io API signature', () => {
      const error = {
        ...mockPutioAPIClientError,
        response: {
          config: {},
          data: {
            error_type: 'API_ERROR',
            error_message: 'Putio API Error',
            status_code: 400,
            extra: { foo: 'bar' },
          },
          headers: {
            'x-trace-id': 'MOCK_TRACE_ID',
          },
          status: 400,
          statusText: 'Error!',
        },
      }

      responseFormatter.onRejected(error).catch(e =>
        expect(e).toMatchInlineSnapshot(`
          Object {
            "error_message": "Putio API Error",
            "error_type": "API_ERROR",
            "extra": Object {
              "foo": "bar",
            },
            "status_code": 400,
            "x-trace-id": "MOCK_TRACE_ID",
          }
        `),
      )
    })

    it('sets error.data property correctly when the request failed with HTTP response but without put.io API signature and no meaningful header config', () => {
      const error: IPutioAPIClientError = {
        ...mockPutioAPIClientError,
        response: {
          config: {},
          headers: {},
          data: 'Bad Gateway',
          status: 502,
          statusText: 'Bad Gateway',
        },
      }

      error.config.headers = undefined

      responseFormatter.onRejected(error).catch(e =>
        expect(e).toMatchInlineSnapshot(`
          Object {
            "error_message": "AXIOS_ERROR_MESSAGE",
            "error_type": "ERROR",
            "extra": Object {},
            "status_code": 502,
            "x-trace-id": undefined,
          }
        `),
      )
    })

    it('sets error.data property correctly when the request failed without put.io API signature', () => {
      responseFormatter.onRejected(mockPutioAPIClientError).catch(e =>
        expect(e).toMatchInlineSnapshot(`
          Object {
            "error_message": "AXIOS_ERROR_MESSAGE",
            "error_type": "ERROR",
            "extra": Object {},
            "status_code": 0,
            "x-trace-id": undefined,
          }
        `),
      )
    })

    it('sets error.data property corrrectly when the request doesnt have response object, but has a request object that is a valid XMLHttpRequest', () => {
      const error: IPutioAPIClientError = {
        ...mockPutioAPIClientError,
        response: undefined,
        request: createMockXMLHttpRequest(
          4,
          400,
          JSON.stringify({ foo: 'bar' }),
        ),
      }

      responseFormatter.onRejected(error).catch(e =>
        expect(e).toMatchInlineSnapshot(`
          Object {
            "error_message": "AXIOS_ERROR_MESSAGE",
            "error_type": "ERROR",
            "extra": Object {},
            "foo": "bar",
            "status_code": 400,
            "x-trace-id": undefined,
          }
        `),
      )
    })

    it('sets error.data property corrrectly when the request doesnt have response object, but has a request object that is a valid XMLHttpRequest', () => {
      const error: IPutioAPIClientError = {
        ...mockPutioAPIClientError,
        response: undefined,
        request: createMockXMLHttpRequest(
          4,
          500,
          'no meaningful response body',
        ),
      }

      responseFormatter.onRejected(error).catch(e =>
        expect(e).toMatchInlineSnapshot(`
          Object {
            "error_message": "MOCK_MESSAGE",
            "error_type": "MOCK_ERROR",
            "extra": Object {
              "foo": "bar",
            },
            "status_code": 0,
          }
        `),
      )
    })
  })

  describe('royally fucked up cases', () => {
    const royallyFuckedUpError = new Error('undefined is not a function')

    responseFormatter
      .onRejected(royallyFuckedUpError as any)
      .catch(e => expect(e).toBe(royallyFuckedUpError))
  })
})
