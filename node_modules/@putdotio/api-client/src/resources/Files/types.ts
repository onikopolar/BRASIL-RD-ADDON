export type FileType =
  | 'FOLDER'
  | 'FILE'
  | 'AUDIO'
  | 'VIDEO'
  | 'IMAGE'
  | 'ARCHIVE'
  | 'PDF'
  | 'TEXT'
  | 'SWF'

export const FileSortOptions = {
  NAME_ASC: 'NAME_ASC',
  NAME_DESC: 'NAME_DESC',
  SIZE_ASC: 'SIZE_ASC',
  SIZE_DESC: 'SIZE_DESC',
  DATE_ASC: 'DATE_ASC',
  DATE_DESC: 'DATE_DESC',
  MODIFIED_ASC: 'MODIFIED_ASC',
  MODIFIED_DESC: 'MODIFIED_DESC',
} as const

export type FileSortOption = typeof FileSortOptions[keyof typeof FileSortOptions]

export interface IFile extends Record<string, any> {
  id: number
  parent_id: number
  name: string
  size: number
  file_type: FileType
  content_type: string
  extension: string
  crc32: string
  created_at: string
}

export interface ISearchResponse {
  files: IFile[]
  total: number
  cursor: string
}

export interface IFileDeleteResponse {
  skipped: number
  cursor: string
}

export type FileConversionStatus = { id: IFile['id'] } & (
  | { status: 'NOT_AVAILABLE' }
  | { status: 'IN_QUEUE' }
  | { status: 'CONVERTING'; percent_done: number }
  | { status: 'COMPLETED'; size: IFile['size'] }
  | { status: 'ERROR' }
)
