import { PutioAPIClient } from '../../client'
import {
  IHistoryClearAllEventsResponse,
  IHistoryDeleteEventResponse,
  IHistoryResponse,
} from './types'

export default class PutioEvents {
  private client: PutioAPIClient

  constructor(client: PutioAPIClient) {
    this.client = client
  }

  public Query() {
    return this.client.get<IHistoryResponse>('/events/list')
  }

  public Delete(id: number) {
    return this.client.post<IHistoryDeleteEventResponse>(`/events/delete/${id}`)
  }

  public Clear() {
    return this.client.post<IHistoryClearAllEventsResponse>('/events/delete')
  }
}
