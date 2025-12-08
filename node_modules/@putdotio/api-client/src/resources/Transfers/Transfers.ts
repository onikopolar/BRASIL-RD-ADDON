import { PutioAPIClient } from '../../client'
import {
  ITransfersResponse,
  Transfer,
  NewTransferParams,
  NewTransferError,
} from './types'

export default class Tranfers {
  private client: PutioAPIClient

  constructor(client: PutioAPIClient) {
    this.client = client
  }

  public Add(params: NewTransferParams) {
    return this.client.post<{ transfer: Transfer }>('/transfers/add', {
      data: params,
    })
  }

  public AddMulti(params: NewTransferParams[]) {
    return this.client.post<{
      transfers: Transfer[]
      errors: NewTransferError[]
    }>('/transfers/add-multi', {
      data: {
        urls: JSON.stringify(params),
      },
    })
  }

  public Get(id: number) {
    return this.client.get<{ transfer: Transfer }>(`/transfers/${id}`)
  }

  public Query({ perPage, total }: { perPage?: number; total?: boolean } = {}) {
    return this.client.get<ITransfersResponse>('/transfers/list', {
      params: {
        per_page: perPage,
        total,
      },
    })
  }

  public Continue(cursor: string, { perPage }: { perPage?: number } = {}) {
    return this.client.post<ITransfersResponse>('/transfers/list/continue', {
      data: {
        cursor,
        per_page: perPage,
      },
    })
  }

  public ClearAll() {
    return this.client.post<{}>('/transfers/clean')
  }

  public Cancel(ids: number[] = []) {
    return this.client.post<{}>('/transfers/cancel', {
      data: {
        transfer_ids: ids.join(','),
      },
    })
  }

  public Retry(id: number) {
    return this.client.post('/transfers/retry', {
      data: { id },
    })
  }

  public Reannounce(id: number) {
    return this.client.post('/transfers/reannounce', {
      data: { id },
    })
  }

  public Count() {
    return this.client.get<{ count: number }>('/transfers/count')
  }
}
