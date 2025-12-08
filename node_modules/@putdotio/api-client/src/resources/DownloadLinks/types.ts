export interface IDownloadLinksCreateResponse {
  id: number
}

export interface IDownloadLinksInfoResponse {
  links: IDownloadLinks
  links_status: DownloadLinksStatuses
}

interface IDownloadLinks {
  download_links: string[]
  mp4_links: string[]
  media_links: string[]
}

export type DownloadLinksStatuses = 'NEW' | 'PROCESSING' | 'DONE' | 'ERROR'
