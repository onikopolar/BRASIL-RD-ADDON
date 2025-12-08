import { PutioAPIClientResponseInterceptorFactory } from '../../client/types'
import { identity } from '../../utils'
import { eventEmitter, EVENTS } from '../../eventEmitter'

export const createErrorEmitter: PutioAPIClientResponseInterceptorFactory = () => ({
  onFulfilled: identity,

  onRejected: error => {
    eventEmitter.emit(EVENTS.ERROR, error)
    return Promise.reject(error)
  },
})
