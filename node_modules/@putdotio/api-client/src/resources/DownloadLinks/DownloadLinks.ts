import { PutioAPIClient } from '../../client'
import {
  IDownloadLinksCreateResponse,
  IDownloadLinksInfoResponse,
} from './types'

export default class DownloadLinks {
  private client: PutioAPIClient

  constructor(client: PutioAPIClient) {
    this.client = client
  }

  public Create({
    ids = [],
    cursor,
    excludeIds = [],
  }: {
    ids?: number[]
    cursor?: string
    excludeIds?: number[]
  }) {
    return this.client.post<IDownloadLinksCreateResponse>(
      '/download_links/create',
      {
        data: {
          file_ids: ids.join(','),
          exclude_ids: excludeIds.join(','),
          cursor,
        },
      },
    )
  }

  public Get(downloadLinksId: number) {
    return this.client.get<IDownloadLinksInfoResponse>(
      `/download_links/${downloadLinksId}`,
    )
  }
}
