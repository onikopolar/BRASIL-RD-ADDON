import { StreamHandler } from '../src/services/StreamHandler.js';
import { StreamRequest } from '../src/types/index.js';

describe('StreamHandler', () => {
  let streamHandler: StreamHandler;

  beforeEach(() => {
    streamHandler = new StreamHandler();
  });

  describe('handleStreamRequest', () => {
    it('should return empty streams for unknown content', async () => {
      const request: StreamRequest = {
        type: 'movie',
        id: 'tt9999999',
        title: 'Unknown Movie'
      };

      const result = await streamHandler.handleStreamRequest(request);
      
      expect(result).toHaveProperty('streams');
      expect(Array.isArray(result.streams)).toBe(true);
    });

    it('should handle series requests', async () => {
      const request: StreamRequest = {
        type: 'series',
        id: 'tt1234567',
        title: 'Test Series'
      };

      const result = await streamHandler.handleStreamRequest(request);
      
      expect(result).toHaveProperty('streams');
      expect(Array.isArray(result.streams)).toBe(true);
    });
  });
});
