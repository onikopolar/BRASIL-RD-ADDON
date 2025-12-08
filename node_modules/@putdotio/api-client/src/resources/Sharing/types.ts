export interface ISharingCloneResponse {
  id: number
}

export interface ISharingCloneInfoResponse {
  shared_file_clone_status: SharingCloneInfoStatuses
}

export type SharingCloneInfoStatuses = 'NEW' | 'PROCESSING' | 'DONE' | 'ERROR'
