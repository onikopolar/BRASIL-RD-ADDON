import {
  createFormDataFromObject,
  isPutioAPIError,
  isPutioAPIErrorResponse,
} from '.'
import {
  mockAxiosError,
  mockPutioAPIClientError,
  mockPutioAPIClientResponse,
} from '../test-utils/mocks'

describe('utils', () => {
  describe('isPutioAPIErrorResponse helper', () => {
    it('validates an object matching the expected shape', () => {
      expect(isPutioAPIErrorResponse(mockPutioAPIClientError.data)).toBe(true)
    })

    it('validates an object not matching the expected shape', () => {
      expect(isPutioAPIErrorResponse(mockPutioAPIClientResponse.data)).toBe(
        false,
      )
    })

    it('validates non-object inputs', () => {
      expect(isPutioAPIErrorResponse('foo')).toBe(false)
    })
  })

  describe('isPutioAPIError helper', () => {
    it('validates an object matching the expected shape', () => {
      expect(isPutioAPIError(mockPutioAPIClientError)).toBe(true)
    })

    it('validates an object not matching the expected shape', () => {
      expect(isPutioAPIError(mockAxiosError)).toBe(false)
    })

    it('validates an error not matching the expected shape', () => {
      expect(isPutioAPIError(new Error('Error!'))).toBe(false)
    })

    it('validates non-object inputs', () => {
      expect(isPutioAPIError('foo')).toBe(false)
    })
  })

  describe('createFormDataFromObject helper', () => {
    it('creates form data from the given object', () => {
      expect(createFormDataFromObject({ foo: 'bar' }).get('foo')).toBe('bar')
    })
  })
})
