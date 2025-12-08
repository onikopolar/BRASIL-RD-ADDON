import EventEmitter from 'event-emitter'

export { EventListener } from 'event-emitter'

export const EVENTS = {
  ERROR: 'ERROR',
  CLIENT_IP_CHANGED: 'CLIENT_IP_CHANGED',
} as const

export type PutioAPIClientEventTypes = typeof EVENTS[keyof typeof EVENTS]

export const eventEmitter = EventEmitter()
