import PutioAPIClient, { isPutioAPIError } from '../../index'

describe('resources/Files/Files', () => {
  const API = new PutioAPIClient({})

  it('should construct correct payload for Upload method', async () => {
    try {
      API.setToken('test-token')

      await API.Files.Upload({
        file: new File([], 'test'),
        parentId: 0,
      })
    } catch (e) {
      if (isPutioAPIError(e)) {
        expect(e.config.headers['Authorization']).toBe(`token test-token`)
      }
    }
  })
})
