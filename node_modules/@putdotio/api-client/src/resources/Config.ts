import { PutioAPIClient } from '../client'

export default class Config {
  private client: PutioAPIClient

  constructor(client: PutioAPIClient) {
    this.client = client
  }

  public Read<Config>() {
    return this.client.get<{ config: Config }>('/config')
  }

  public Write<Config>(config: Config) {
    return this.client.put<{}>('/config', {
      data: { config },
    })
  }

  public GetKey<Config, Key extends keyof Config>(key: Key) {
    return this.client.get<{ value: Config[Key] }>(`/config/${key}`)
  }

  public SetKey<Config, Key extends keyof Config>(
    key: Key,
    value: Config[Key],
  ) {
    return this.client.put<{}>(`/config/${key}`, {
      data: { value },
    })
  }

  public DeleteKey<Config, Key extends keyof Config>(key: Key) {
    return this.client.delete<{}>(`/config/${key}`)
  }
}
