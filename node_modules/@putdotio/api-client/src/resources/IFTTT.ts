import { PutioAPIClient } from '../client'

export default class IFTTT {
  private client: PutioAPIClient

  constructor(client: PutioAPIClient) {
    this.client = client
  }

  public SendEvent({
    clientName,
    eventType,
    ingredients = {},
  }: {
    clientName?: string
    eventType: string
    ingredients: object
  }) {
    return this.client.post('/ifttt-client/event', {
      data: {
        client_name: clientName,
        event_type: eventType,
        ingredients,
      },
    })
  }
}
