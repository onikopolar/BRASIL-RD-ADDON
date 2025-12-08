import { PutioAPIClient } from '../../client'
import {
  IAccountInfo,
  AccountInfoParams,
  IAccountSettings,
  SaveAccountSettingsPayload,
  IAccountConfirmation,
  AccountClearOptions,
} from './types'

export default class Account {
  private client: PutioAPIClient

  constructor(client: PutioAPIClient) {
    this.client = client
  }

  public Info(params: AccountInfoParams = {}) {
    return this.client.get<{ info: IAccountInfo }>('/account/info', {
      params,
    })
  }

  public Settings() {
    return this.client.get<{ settings: IAccountSettings }>('/account/settings')
  }

  public SaveSettings(payload: SaveAccountSettingsPayload) {
    return this.client.post('/account/settings', {
      data: payload,
    })
  }

  public Clear(options: AccountClearOptions) {
    return this.client.post<{}>('/account/clear', {
      data: options,
    })
  }

  public Destroy(currentPassword: string) {
    return this.client.post<{}>('/account/destroy', {
      data: {
        current_password: currentPassword,
      },
    })
  }

  public Confirmations(type?: IAccountConfirmation['subject']) {
    return this.client.get<{ confirmations: IAccountConfirmation[] }>(
      '/account/confirmation/list',
      {
        data: {
          type,
        },
      },
    )
  }
}
