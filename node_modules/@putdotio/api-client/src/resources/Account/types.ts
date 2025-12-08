export interface IAccountSettings {
  beta_user: boolean
  callback_url: string
  dark_theme: boolean
  default_download_folder: number
  disable_subtitles: boolean
  dont_autoselect_subtitles: boolean
  fluid_layout: boolean
  hide_subtitles: boolean
  history_enabled: boolean
  is_invisible: boolean
  locale: string
  login_mails_enabled: boolean
  next_episode: boolean
  pushover_token: string | null
  show_optimistic_usage: boolean
  sort_by: string
  start_from: boolean
  subtitle_languages: [string | null, string | null]
  theater_mode: boolean
  theme: 'dark' | 'light' | 'auto'
  transfer_sort_by: string
  trash_enabled: boolean
  tunnel_route_name: null | string
  two_factor_enabled: boolean
  use_private_download_ip: boolean
  use_start_from: boolean
  video_player: 'html5' | 'flash' | null
}

export type SaveAccountSettingsPayload =
  | Partial<IAccountSettings>
  | { username: string }
  | {
      mail: string
      current_password: string
    }
  | {
      password: string
      current_password: string
    }
  | {
      two_factor_enabled: {
        enable: boolean
        code: string
      }
    }

export interface IAccountInfo {
  account_status: 'active' | 'inactive' | 'stranger'
  avatar_url: string
  can_create_sub_account: boolean
  disk: {
    avail: number
    used: number
    size: number
  }
  download_token?: string
  family_owner?: string
  features: Record<string, boolean>
  files_will_be_deleted_at: string | null
  is_admin: boolean
  is_eligible_for_friend_invitation: boolean
  is_sub_account: boolean
  mail: string
  monthly_bandwidth_usage: number
  pas?: { user_hash: string }
  push_token?: string
  password_last_changed_at: string | null
  private_download_host_ip: string | null
  settings: IAccountSettings
  trash_size: number
  user_hash: string
  user_id: number
  username: string
  warnings: {
    callback_url_has_failed?: boolean
    pushover_token_has_failed?: boolean
  }
}

export interface IAccountConfirmation {
  subject: 'mail_change' | 'password_change' | 'subscription_upgrade'
  created_at: string
}

export const ACCOUNT_CLEAR_OPTION_KEYS = [
  'files',
  'finished_transfers',
  'active_transfers',
  'rss_feeds',
  'rss_logs',
  'history',
  'trash',
  'friends',
] as const

export type AccountInfoParams = {
  download_token?: 0 | 1
  push_token?: 0 | 1
  sharing?: 0 | 1
  features?: 0 | 1
  intercom?: 0 | 1
  pas?: 0 | 1
  profitwell?: 0 | 1
  platform?: string
}

export type AccountClearOptions = Record<
  typeof ACCOUNT_CLEAR_OPTION_KEYS[number],
  boolean
>
