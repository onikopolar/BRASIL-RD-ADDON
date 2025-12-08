interface IHistoryBaseEvent {
  id: number
  created_at: string
  user_id: number
}

interface IHistoryFileEvent extends IHistoryBaseEvent {
  file_id: number
  file_name: string
  file_size: number
}

export interface IHistoryFileSharedEvent extends IHistoryFileEvent {
  type: 'file_shared'
  sharing_user_name: string
}

export interface IHistoryUploadEvent extends IHistoryFileEvent {
  type: 'upload'
}

export interface IHistoryFileFromRSSDeletedEvent extends IHistoryFileEvent {
  type: 'file_from_rss_deleted_for_space'
  file_source: string
}

interface IHistoryTransferEvent extends IHistoryBaseEvent {
  source: string
  transfer_name: string
}

export interface IHistoryTransferCompletedEvent extends IHistoryTransferEvent {
  type: 'transfer_completed'
  file_id: number
  transfer_size: number
}

export interface IHistoryTransferErrorEvent extends IHistoryTransferEvent {
  type: 'transfer_error'
}

export interface IHistoryTransferCallbackErrorEvent extends IHistoryBaseEvent {
  type: 'transfer_callback_error'
  transfer_id: number
  transfer_name: string
  message: string
}

export interface IHistoryPrivateTorrentPinEvent extends IHistoryBaseEvent {
  type: 'private_torrent_pin'
  user_download_name: string
  pinned_host_ip: string
  new_host_ip: string
}

export interface IHistoryRSSFilterPausedEvent extends IHistoryBaseEvent {
  type: 'rss_filter_paused'
  rss_filter_id: number
  rss_filter_title: string
}

export interface IHistoryZipCreatedEvent extends IHistoryBaseEvent {
  type: 'zip_created'
  zip_id: number
  zip_size: number
}

export interface IHistoryVoucherEvent extends IHistoryBaseEvent {
  type: 'voucher'
  voucher: number
  voucher_owner_id: number
  voucher_owner_name: string
}

export interface IHistoryTransferFromRSSErrorEvent extends IHistoryBaseEvent {
  type: 'transfer_from_rss_error'
  rss_id: number
  transfer_name: string
}

export type IHistoryEvent =
  | IHistoryFileSharedEvent
  | IHistoryUploadEvent
  | IHistoryFileFromRSSDeletedEvent
  | IHistoryTransferCompletedEvent
  | IHistoryTransferErrorEvent
  | IHistoryTransferFromRSSErrorEvent
  | IHistoryTransferCallbackErrorEvent
  | IHistoryPrivateTorrentPinEvent
  | IHistoryRSSFilterPausedEvent
  | IHistoryVoucherEvent
  | IHistoryZipCreatedEvent

export interface IHistoryResponse {
  events: IHistoryEvent[]
}

export interface IHistoryDeleteEventResponse {
  success: 'OK'
}

export interface IHistoryClearAllEventsResponse {
  success: 'OK'
}
