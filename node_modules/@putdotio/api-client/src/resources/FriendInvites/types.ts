export type FriendInviteJoinedUserStatus =
  | 'CONVERTED'
  | 'IN_TRIAL'
  | 'TRIAL_ENDED'
  | 'TRIAL_NOT_STARTED'

export interface IFriendInviteJoinedUser {
  name: string
  avatar_url: string
  created_at: string
  earned_amount: number
  status: FriendInviteJoinedUserStatus
}

export interface IFriendInvite {
  code: string
  created_at: string
  user?: IFriendInviteJoinedUser
}

export interface IFriendInvitesResponse {
  invites: IFriendInvite[]
  remaining_limit: number
}

export interface IFriendInvitesCreateResponse {
  code: string
}
