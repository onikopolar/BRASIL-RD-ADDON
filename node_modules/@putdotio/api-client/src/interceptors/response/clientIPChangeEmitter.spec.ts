import { eventEmitter, EVENTS } from '../../eventEmitter'
import {
  mockPutioAPIClientError,
  mockPutioAPIClientResponse,
} from '../../test-utils/mocks'
import {
  IPutioAPIClientError,
  PutioAPIClientResponseInterceptor,
} from '../../client/types'
import { DEFAULT_CLIENT_OPTIONS } from '../../constants'
import { createClientIPChangeEmitter } from './clientIPChangeEmitter'

describe('interceptors/response/clientIPChangeEmitter', () => {
  const eventEmitterEmit = jest.spyOn(eventEmitter, 'emit')
  let clientIPChangeEmitter: PutioAPIClientResponseInterceptor

  beforeEach(() => {
    jest.resetAllMocks()
    clientIPChangeEmitter = createClientIPChangeEmitter(DEFAULT_CLIENT_OPTIONS)
  })

  it('does not call client.emit method if the IP does not change', () => {
    clientIPChangeEmitter.onFulfilled(mockPutioAPIClientResponse)
    clientIPChangeEmitter.onFulfilled(mockPutioAPIClientResponse)
    expect(eventEmitterEmit).not.toHaveBeenCalled()
  })

  it('does not call client.emit method if the IP changes from initial state', () => {
    clientIPChangeEmitter.onFulfilled(mockPutioAPIClientResponse)
    clientIPChangeEmitter.onFulfilled({
      ...mockPutioAPIClientResponse,
      headers: { 'putio-client-ip': 1 },
    })
    expect(eventEmitterEmit).not.toHaveBeenCalled()
  })

  it('calls client.emit method if the IP changes once', () => {
    clientIPChangeEmitter.onFulfilled({
      ...mockPutioAPIClientResponse,
      headers: { 'putio-client-ip': '198.168.0.1' },
    })

    clientIPChangeEmitter.onFulfilled({
      ...mockPutioAPIClientResponse,
      headers: { 'putio-client-ip': '198.168.0.2' },
    })

    expect(eventEmitterEmit).toBeCalledWith(EVENTS.CLIENT_IP_CHANGED, {
      IP: '198.168.0.1',
      newIP: '198.168.0.2',
    })
  })

  it('calls client.emit method if the IP changes multiple times', () => {
    clientIPChangeEmitter.onFulfilled({
      ...mockPutioAPIClientResponse,
      headers: { 'putio-client-ip': '198.168.0.1' },
    })

    clientIPChangeEmitter.onFulfilled({
      ...mockPutioAPIClientResponse,
      headers: { 'putio-client-ip': '198.168.0.2' },
    })

    expect(eventEmitterEmit).toBeCalledWith(EVENTS.CLIENT_IP_CHANGED, {
      IP: '198.168.0.1',
      newIP: '198.168.0.2',
    })

    clientIPChangeEmitter.onFulfilled({
      ...mockPutioAPIClientResponse,
      headers: { 'putio-client-ip': '198.168.0.1' },
    })

    expect(eventEmitterEmit).toBeCalledWith(EVENTS.CLIENT_IP_CHANGED, {
      IP: '198.168.0.2',
      newIP: '198.168.0.1',
    })

    expect(eventEmitterEmit).toBeCalledTimes(2)
  })

  it('calls client.emit method once if the IP changes to a falsy value', () => {
    clientIPChangeEmitter.onFulfilled({
      ...mockPutioAPIClientResponse,
      headers: { 'putio-client-ip': '198.168.0.1' },
    })

    clientIPChangeEmitter.onFulfilled({
      ...mockPutioAPIClientResponse,
      headers: { 'putio-client-ip': '198.168.0.2' },
    })

    expect(eventEmitterEmit).toBeCalledWith(EVENTS.CLIENT_IP_CHANGED, {
      IP: '198.168.0.1',
      newIP: '198.168.0.2',
    })

    clientIPChangeEmitter.onFulfilled(mockPutioAPIClientResponse)

    expect(eventEmitterEmit).toBeCalledTimes(1)
  })

  it('handles failed requests and updates the IP', () => {
    const error: IPutioAPIClientError = {
      ...mockPutioAPIClientError,
      response: {
        config: {},
        data: {
          error_type: 'API_ERROR',
          error_message: 'Putio API Error',
          status_code: 400,
          extra: { foo: 'bar' },
        },
        headers: { 'putio-client-ip': '0.0.0.0' },
        status: 400,
        statusText: 'Error!',
      },
    }

    clientIPChangeEmitter.onRejected(error).catch(e => expect(e).toEqual(error))

    clientIPChangeEmitter.onFulfilled({
      ...mockPutioAPIClientResponse,
      headers: { 'putio-client-ip': '1.1.1.1' },
    })

    expect(eventEmitterEmit).toBeCalledWith(EVENTS.CLIENT_IP_CHANGED, {
      IP: '0.0.0.0',
      newIP: '1.1.1.1',
    })
  })

  it('does not call client.emit method if the error is not recognized', () => {
    const error = new Error()

    clientIPChangeEmitter
      .onRejected(error as any)
      .catch(e => expect(e).toEqual(error))

    expect(eventEmitterEmit).not.toHaveBeenCalled()
  })
})
