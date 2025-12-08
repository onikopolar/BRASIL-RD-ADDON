import { eventEmitter, EVENTS } from '../../eventEmitter'
import {
  mockPutioAPIClientError,
  mockPutioAPIClientResponse,
} from '../../test-utils/mocks'
import { IPutioAPIClientError } from '../../client/types'
import { DEFAULT_CLIENT_OPTIONS } from '../../constants'
import { createErrorEmitter } from './errorEmitter'

describe('interceptors/response/errorEmitter', () => {
  const eventEmitterEmit = jest.spyOn(eventEmitter, 'emit')
  const errorEmitter = createErrorEmitter(DEFAULT_CLIENT_OPTIONS)

  beforeEach(jest.resetAllMocks)

  describe('successful responses', () => {
    it('does not call client.emit method', () => {
      errorEmitter.onFulfilled(mockPutioAPIClientResponse)
      expect(eventEmitterEmit).not.toHaveBeenCalled()
    })
  })

  describe('failed responses', () => {
    it('calls client.emit method with correct signature', () => {
      const error: IPutioAPIClientError = {
        ...mockPutioAPIClientError,
        response: {
          config: {},
          data: {
            status_code: 400,
            error_type: 'API_ERROR',
            error_message: 'Putio API Error',
            extra: { foo: 'bar' },
          },
          headers: {},
          status: 400,
          statusText: 'Error!',
        },
      }

      errorEmitter.onRejected(error).catch(e => expect(e).toEqual(error))
      expect(eventEmitterEmit).toHaveBeenCalledWith(EVENTS.ERROR, error)
    })
  })
})
