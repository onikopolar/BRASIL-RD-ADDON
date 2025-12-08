import { PutioAPIClient } from '../client'

export default class Trash {
  private client: PutioAPIClient

  constructor(client: PutioAPIClient) {
    this.client = client
  }

  public List({ limit = 50 } = {}) {
    return this.client.get('/trash/list', {
      params: {
        per_page: limit,
      },
    })
  }

  public Continue(cursor: string, { limit = 50 } = {}) {
    return this.client.post('/trash/list/continue', {
      data: {
        cursor,
        per_page: limit,
      },
    })
  }

  public Restore({
    useCursor = false,
    ids = [],
    cursor,
  }: {
    useCursor?: boolean
    ids?: number[]
    cursor?: string
  }) {
    return this.client.post('/trash/restore', {
      data: {
        cursor: useCursor ? cursor : undefined,
        file_ids: !useCursor ? ids.join(',') : undefined,
      },
    })
  }

  public Delete({
    useCursor = false,
    ids = [],
    cursor,
  }: {
    useCursor?: boolean
    ids?: number[]
    cursor?: string
  }) {
    return this.client.post('/trash/delete', {
      data: {
        cursor: useCursor ? cursor : undefined,
        file_ids: !useCursor ? ids.join(',') : undefined,
      },
    })
  }

  public Empty() {
    return this.client.post('/trash/empty')
  }
}
