export interface IFriend {
  id: number
  name: string
  avatar_url: string
  has_received_files: boolean
  has_shared_files: boolean
}

export interface IFriendListResponse {
  friends: IFriend[]
  total: number
}

export interface IUserSearchResult
  extends Pick<IFriend, 'id' | 'name' | 'avatar_url'> {
  invited: boolean
}

export interface IUserSearchResponse {
  users: IUserSearchResult[]
}
