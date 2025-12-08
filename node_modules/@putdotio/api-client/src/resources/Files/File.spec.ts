import PutioAPIClient from '../../index'

describe('resources/Files/File', () => {
  const API = new PutioAPIClient({
    baseURL: '',
  })

  it('should create correct HLS stream URL when no params given', () => {
    expect(API.File.GetHLSStreamURL(0)).toBe('/files/0/hls/media.m3u8')
  })

  it('should add token to HLS stream url if set', () => {
    API.setToken('token')

    expect(API.File.GetHLSStreamURL(0)).toBe(
      '/files/0/hls/media.m3u8?oauth_token=token',
    )

    API.clearToken()
  })

  it('should create correct HLS stream URL when params given', () => {
    expect(API.File.GetHLSStreamURL(0, { playOriginal: true })).toBe(
      '/files/0/hls/media.m3u8?original=1',
    )

    expect(API.File.GetHLSStreamURL(0, { maxSubtitleCount: 1 })).toBe(
      '/files/0/hls/media.m3u8?max_subtitle_count=1',
    )

    expect(
      API.File.GetHLSStreamURL(0, { playOriginal: true, maxSubtitleCount: 1 }),
    ).toBe('/files/0/hls/media.m3u8?max_subtitle_count=1&original=1')
  })
})
