/**
 * Integration tests for cross-module behavior not covered by unit tests.
 *
 * Most of the original tests here were duplicates of unit-level coverage
 * in config.test.ts, mcp-oauth-utils.test.ts, and utils.test.ts.
 * Only tests that exercise behavior unique to module integration remain.
 */

import { jest } from '@jest/globals';

describe('Core Integration Tests', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  describe('Custom error classes', () => {
    it('AuthError and APIError carry structured context for callers', async () => {
      const { AuthError, APIError } = await import('../../src/lib/oauth-types.js');

      const authError = new AuthError('Invalid credentials', 'INVALID_CREDENTIALS');
      expect(authError).toBeInstanceOf(Error);
      expect(authError.message).toBe('Invalid credentials');

      const apiError = new APIError('API request failed', 500, '/test/endpoint');
      expect(apiError).toBeInstanceOf(Error);
      expect(apiError.statusCode).toBe(500);
      expect(apiError.endpoint).toBe('/test/endpoint');
      expect(apiError.message).toBe('API request failed');
    });
  });
});
