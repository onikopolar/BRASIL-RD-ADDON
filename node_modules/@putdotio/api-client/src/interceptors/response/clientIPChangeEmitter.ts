import { AxiosResponse } from 'axios'
import { PutioAPIClientResponseInterceptorFactory } from '../../client/types'
import { eventEmitter, EVENTS } from '../../eventEmitter'

const IP_HEADER_KEY = 'putio-client-ip'

export const createClientIPChangeEmitter: PutioAPIClientResponseInterceptorFactory = () => {
  let IP: string = ''

  const checkIP = (response: AxiosResponse) => {
    const newIP = response.headers[IP_HEADER_KEY]

    if (!IP) {
      IP = newIP
      return
    }

    if (newIP && IP !== newIP) {
      eventEmitter.emit(EVENTS.CLIENT_IP_CHANGED, { IP, newIP })
      IP = newIP
      return
    }
  }

  return {
    onFulfilled: response => {
      checkIP(response)
      return response
    },

    onRejected: error => {
      if (error.response) {
        checkIP(error.response)
      }

      return Promise.reject(error)
    },
  }
}
