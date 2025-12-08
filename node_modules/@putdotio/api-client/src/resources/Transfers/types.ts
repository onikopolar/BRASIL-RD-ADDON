import { ISODateString } from '../../utils/types'
import { IFile } from '../../resources/Files/types'

export type NewTransferParams = {
  url: string
  save_parent_id?: IFile['id']
  callback_url?: string
}

export type NewTransferError = {
  url: NewTransferParams['url']
  status_code: number
  error_type: string
}

type TransferType = 'URL' | 'TORRENT' | 'PLAYLIST' | 'LIVE_STREAM' | 'N/A'

type TransferStatus =
  | 'WAITING'
  | 'PREPARING_DOWNLOAD'
  | 'IN_QUEUE'
  | 'DOWNLOADING'
  | 'WAITING_FOR_COMPLETE_QUEUE'
  | 'WAITING_FOR_DOWNLOADER'
  | 'COMPLETING'
  | 'STOPPING'
  | 'SEEDING'
  | 'COMPLETED'
  | 'ERROR'

type TransferLink = { url: string; label: string }

type BaseTransfer = {
  availability: null | number
  created_at: ISODateString
  current_ratio: null | number
  down_speed: number
  downloaded: number
  error_message: null | string
  estimated_time: null | number
  file_id: null | number
  finished_at: null | ISODateString
  id: number
  is_private: boolean
  name: string
  save_parent_id: number
  seconds_seeding: null | number
  size: number
  source: string
  started_at: null | ISODateString
  status: TransferStatus
  type: TransferType
  subscription_id: null | number // ID of the RSS Feed
  uploaded: number
  up_speed: number

  // not documented on api.put.io
  callback_url: null | string // not used in clients
  client_ip: null | string

  completion_percent: number // ⬇️ are they different?
  percent_done: number // ⬆️

  created_torrent: boolean // not used in clients
  download_id: number // not used in clients
  hash: null | string // not used in clients
  links: TransferLink[] // used in admin
  peers_connected: number
  peers_getting_from_us: number // not used in clients
  peers_sending_to_us: number // not used in clients
  simulated: boolean // not used in clients
  torrent_link: null | string
  tracker: null | string // not used in clients
  tracker_message: null | string

  updated_at?: ISODateString // not used in clients

  userfile_exists?: boolean
}

type FinishedTransfer = BaseTransfer & {
  finished_at: ISODateString
  file_id: number
}

/* by status */
type CompletedTransfer = FinishedTransfer & {
  status: 'COMPLETED'
}

type FailedTransfer = BaseTransfer & {
  status: 'ERROR'
  error_message: string
}

/* by status, but scoped to type */
type PreparingSeedingTorrentTransfer = FinishedTransfer & {
  type: 'TORRENT'
  status: 'PREPARING_SEED'
}

type SeedingTorrentTransfer = FinishedTransfer & {
  type: 'TORRENT'
  status: 'SEEDING'
  seconds_seeding: number
  current_ratio: number
}

type CompletedTorrentTransfer = SeedingTorrentTransfer & {
  status: 'COMPLETED'
}

/* by type */
export type TorrentTransfer = (
  | BaseTransfer
  | FailedTransfer
  | SeedingTorrentTransfer
  | PreparingSeedingTorrentTransfer
  | CompletedTorrentTransfer
) & {
  type: 'TORRENT'
  torrent_link: string
}

export type URLTransfer = (
  | BaseTransfer
  | FailedTransfer
  | CompletedTransfer
) & {
  type: 'URL'
}

export type PlaylistTransfer = (
  | BaseTransfer
  | FailedTransfer
  | CompletedTransfer
) & {
  type: 'PLAYLIST'

  // not documented in swagger
  // not present in transfers/list response, but comes within socket updates.
  downloaded_items: number
  total_items: number

  // why present in this one? it's not live recording.
  recorded_seconds: number
}

export type LiveStreamTransfer = (
  | BaseTransfer
  | FailedTransfer
  | CompletedTransfer
) & {
  type: 'LIVE_STREAM'

  // not documented in swagger
  recorded_seconds: number
}

export type Transfer =
  | TorrentTransfer
  | URLTransfer
  | PlaylistTransfer
  | LiveStreamTransfer

export interface ITransfersResponse {
  transfers: Transfer[]
  total: number
  cursor: string
}
