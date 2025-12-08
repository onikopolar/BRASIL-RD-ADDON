import { ISODateString } from 'utils/types'

export interface ILoginResponse {
  access_token: string
  user_id: number
}

export interface IValidateTokenResponse {
  result: boolean
  token_id: number
  token_scope: 'default' | 'two_factor'
  user_id: number
}

export type TwoFactorRecoveryCodes = {
  created_at: ISODateString
  codes: Array<{
    code: string
    used_at: ISODateString | null
  }>
}

export interface IGenerateTOTPResponse {
  secret: string
  uri: string
  recovery_codes: TwoFactorRecoveryCodes
}

export interface IVerifyTOTPResponse {
  token: string
  user_id: number
}

export type OAuthApp = {
  id: number
  name: string
  description: string
  website: string
  has_icon: boolean
}

export type MyOAuthApp = OAuthApp & {
  users: number
  callback: string
  secret: string
  hidden: boolean
}

export type PopularOAuthApp = OAuthApp & {
  maker: string
  /** admin only */
  hidden?: boolean
  /** admin only */
  users?: number
}

export type OAuthAppSession = {
  id: number
  app_id: OAuthApp['id']
  app_name: OAuthApp['name']
  active: boolean
  client_name: string
  ip_address: string
  user_agent: string
  note: string | null
  created_at: string
  last_used_at: string
}
