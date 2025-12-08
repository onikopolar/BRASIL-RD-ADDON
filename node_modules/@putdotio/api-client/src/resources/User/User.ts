import { PutioAPIClient } from '../../client'
import {
  IUserInfoResponse,
  IUserSettingsResponse,
  IUserConfirmationsResponse,
  ConfirmationSubject,
  ClearDataOptions,
} from './types'

export default class User {
  private client: PutioAPIClient

  constructor(client: PutioAPIClient) {
    this.client = client
  }

  /**
   * @deprecated Use `Account.Info` method instead.
   */
  public Info(params: Record<string, string | number>) {
    return this.client.get<IUserInfoResponse>('/account/info', {
      params,
    })
  }

  /**
   * @deprecated Use `Account.Settings` method instead.
   */
  public Settings() {
    return this.client.get<IUserSettingsResponse>('/account/settings')
  }

  /**
   * @deprecated Use `Account.SaveSettings` method instead.
   */
  public SaveSettings(settings: Record<string, any>) {
    return this.client.post('/account/settings', {
      data: settings,
    })
  }

  /**
   * @deprecated Use `Config.Read` method instead.
   */
  public Config() {
    return this.client.get<Record<string, unknown>>('/config')
  }

  /**
   * @deprecated Use `Config.Write` method instead.
   */
  public SaveConfig(config: Record<string, unknown>) {
    return this.client.put('/config', {
      data: { config },
    })
  }

  /**
   * @deprecated Use `Account.Clear` method instead.
   */
  public ClearData(options: ClearDataOptions) {
    return this.client.post<{}>('/account/clear', {
      data: options,
    })
  }

  /**
   * @deprecated Use `Account.Destroy` method instead.
   */
  public Destroy(currentPassword: string) {
    return this.client.post<{}>('/account/destroy', {
      data: {
        current_password: currentPassword,
      },
    })
  }

  /**
   * @deprecated Use `Account.Confirmations` method instead.
   */
  public Confirmations(type?: ConfirmationSubject) {
    return this.client.get<IUserConfirmationsResponse>(
      '/account/confirmation/list',
      {
        data: {
          type,
        },
      },
    )
  }
}
