import { PutioAPIClient } from '../../client'
import { ISharingCloneResponse, ISharingCloneInfoResponse } from './types'

export default class Sharing {
  private client: PutioAPIClient

  constructor(client: PutioAPIClient) {
    this.client = client
  }

  public Clone({
    ids = [],
    cursor,
    excludeIds = [],
    parentId = 0,
  }: {
    ids?: number[]
    cursor?: string
    excludeIds?: number[]
    parentId?: number
  }) {
    return this.client.post<ISharingCloneResponse>('/sharing/clone', {
      data: {
        file_ids: ids.join(','),
        exclude_ids: excludeIds.join(','),
        parent_id: parentId,
        cursor,
      },
    })
  }

  public CloneInfo(cloneInfoId: number) {
    return this.client.get<ISharingCloneInfoResponse>(
      `/sharing/clone/${cloneInfoId}`,
    )
  }
}
