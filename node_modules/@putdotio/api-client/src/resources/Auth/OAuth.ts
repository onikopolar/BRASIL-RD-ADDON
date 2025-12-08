import URI from 'urijs'
import { createFormDataFromObject } from '../../utils'
import { PutioAPIClient } from '../../client'
import { MyOAuthApp, PopularOAuthApp } from './types'

export default class OAuth {
  private client: PutioAPIClient

  constructor(client: PutioAPIClient) {
    this.client = client
  }

  public GetAuthorizeURL(query: object = {}): string {
    const {
      token,
      options: { baseURL },
    } = this.client

    const uri = new URI(`${baseURL}/oauth2/authorize`).addQuery({
      ...query,
      oauth_token: token,
    })

    return uri.toString()
  }

  public Query() {
    return this.client.get<{ apps: MyOAuthApp[] }>('/oauth/apps')
  }

  public Get(id: MyOAuthApp['id']) {
    return this.client.get<{ app: MyOAuthApp; token: string }>(
      `/oauth/apps/${id}`,
    )
  }

  public GetIconURL(id: MyOAuthApp['id']): string {
    const {
      token,
      options: { baseURL },
    } = this.client

    return `${baseURL}/oauth/apps/${id}/icon?oauth_token=${token}`
  }

  public SetIcon(id: MyOAuthApp['id'], data: object) {
    return this.client.post(`/oauth/apps/${id}/icon`, { data })
  }

  public Create(app: Omit<MyOAuthApp, 'id'>) {
    return this.client.post<{ app: MyOAuthApp }>('/oauth/apps/register', {
      data: createFormDataFromObject(app),
    })
  }

  public Update(app: MyOAuthApp) {
    return this.client.post<{ app: MyOAuthApp }>(`/oauth/apps/${app.id}`, {
      data: createFormDataFromObject(app),
    })
  }

  public Delete(id: MyOAuthApp['id']) {
    return this.client.post(`/oauth/apps/${id}/delete`)
  }

  public RegenerateToken(id: MyOAuthApp['id']) {
    return this.client.post<{ access_token: string }>(
      `/oauth/apps/${id}/regenerate_token`,
    )
  }

  public GetPopularApps() {
    return this.client.get<{ apps: PopularOAuthApp[] }>('/oauth/apps/popular')
  }
}
