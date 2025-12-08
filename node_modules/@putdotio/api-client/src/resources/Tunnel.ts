import { PutioAPIClient } from '../client'

export default class Tunnel {
  private client: PutioAPIClient

  constructor(client: PutioAPIClient) {
    this.client = client
  }

  public Routes() {
    return this.client.get('/tunnel/routes')
  }
}
