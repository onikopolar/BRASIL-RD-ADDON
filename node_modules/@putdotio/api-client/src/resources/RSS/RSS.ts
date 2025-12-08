import { PutioAPIClient } from '../../client'
import { RSSFeed, RSSFeedItem, RSSFeedParams } from './types'

export default class RSS {
  private client: PutioAPIClient

  constructor(client: PutioAPIClient) {
    this.client = client
  }

  public Query() {
    return this.client.get<{ feeds: RSSFeed[] }>('/rss/list')
  }

  public Get(id: RSSFeed['id']) {
    return this.client.get<{ feed: RSSFeed }>(`/rss/${id}`)
  }

  public Create(rss: RSSFeedParams) {
    return this.client.post<{ feed: RSSFeed }>('/rss/create', {
      data: rss,
    })
  }

  public Update(id: RSSFeed['id'], rss: RSSFeedParams) {
    return this.client.post<{}>(`/rss/${id}`, {
      data: rss,
    })
  }

  public Pause(id: RSSFeed['id']) {
    return this.client.post<{}>(`/rss/${id}/pause`)
  }

  public Resume(id: RSSFeed['id']) {
    return this.client.post<{}>(`/rss/${id}/resume`)
  }

  public Delete(id: RSSFeed['id']) {
    return this.client.post<{}>(`/rss/${id}/delete`)
  }

  public Logs(id: RSSFeed['id']) {
    return this.client.get<{
      feed: RSSFeed
      items: RSSFeedItem[]
    }>(`/rss/${id}/items`)
  }

  public ClearLogs(id: RSSFeed['id']) {
    return this.client.post<{}>(`/rss/${id}/clear-log`)
  }

  public RetryItem(id: RSSFeed['id'], itemId: RSSFeedItem['id']) {
    return this.client.post<{}>(`/rss/${id}/items/${itemId}/retry`)
  }
}
