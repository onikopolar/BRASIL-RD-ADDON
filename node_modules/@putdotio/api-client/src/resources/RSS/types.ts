import { IFile } from '../Files/types'

export type RSSFeed = {
  created_at: string
  delete_old_files: boolean
  extract: boolean
  id: number
  keyword: string | null
  last_error: string | null
  last_fetch: string | null
  parent_dir_id: IFile['id']
  parentdirid: IFile['id']
  paused: boolean
  paused_at: string | null
  rss_source_url: string
  start_at: string | null
  title: string
  unwanted_keywords: string
  updated_at: string
}

export type RSSFeedParams = Pick<
  RSSFeed,
  | 'title'
  | 'rss_source_url'
  | 'parent_dir_id'
  | 'delete_old_files'
  | 'keyword'
  | 'unwanted_keywords'
> & {
  dont_process_whole_feed: boolean
}

type RSSFeedItemCommon = {
  detected_date: string
  id: number
  publish_date: string
  title: string
  processed_at: string
}

export type RSSFeedItemSucceeded = RSSFeedItemCommon & {
  is_failed: false
  user_file_id: null | number
}

export type RSSFeedItemFailed = RSSFeedItemCommon & {
  is_failed: true
  failure_reason: string
}

export type RSSFeedItem = RSSFeedItemSucceeded | RSSFeedItemFailed
