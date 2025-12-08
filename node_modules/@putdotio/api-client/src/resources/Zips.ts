import { PutioAPIClient } from '../client'

export default class Zips {
  private client: PutioAPIClient

  constructor(client: PutioAPIClient) {
    this.client = client
  }

  public Query() {
    return this.client.get('/zips/list')
  }

  public Create({
    cursor,
    excludeIds = [],
    ids = [],
  }: {
    cursor?: string
    excludeIds?: number[]
    ids: number[]
  }) {
    return this.client.post('/zips/create', {
      data: {
        cursor,
        exclude_ids: excludeIds.join(','),
        file_ids: ids.join(','),
      },
    })
  }

  public Get(id: number) {
    return this.client.get(`/zips/${id}`)
  }

  public Retry(id: number) {
    return this.client.get(`/zips/${id}/retry`)
  }

  public Cancel(id: number) {
    return this.client.get(`/zips/${id}/cancel`)
  }
}
