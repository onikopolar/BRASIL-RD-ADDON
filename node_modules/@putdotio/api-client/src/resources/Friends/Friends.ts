import { PutioAPIClient } from '../../client'
import { IFriendListResponse, IUserSearchResponse } from './types'

export default class Friends {
  private client: PutioAPIClient

  constructor(client: PutioAPIClient) {
    this.client = client
  }

  public Query() {
    return this.client.get<IFriendListResponse>('/friends/list')
  }

  public Search(username: string) {
    return this.client.get<IUserSearchResponse>(
      `/friends/user-search/${username}`,
    )
  }

  public WaitingRequests() {
    return this.client.get('/friends/waiting-requests')
  }

  public WaitingRequestsCount() {
    return this.client.get('/friends/waiting-requests-count')
  }

  public SendFrienshipRequest(username: string) {
    return this.client.post(`/friends/${username}/request`)
  }

  public Remove(username: string) {
    return this.client.post(`/friends/${username}/unfriend`)
  }

  public Approve(username: string) {
    return this.client.post(`/friends/${username}/approve`)
  }

  public Deny(username: string) {
    return this.client.post(`/friends/${username}/deny`)
  }

  public SharedFolder(username: string) {
    return this.client.get(`/friends/${username}/files`)
  }
}
