import { PutioAPIClient } from '../../client'
import { IFriendInvitesCreateResponse, IFriendInvitesResponse } from './types'

export default class FriendInvites {
  private client: PutioAPIClient

  constructor(client: PutioAPIClient) {
    this.client = client
  }

  public GetAll() {
    return this.client.get<IFriendInvitesResponse>('/account/friend_invites')
  }

  public Create() {
    return this.client.post<IFriendInvitesCreateResponse>(
      '/account/create_friend_invitation',
    )
  }
}
