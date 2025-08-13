/**
 * Jest setup file for mcp-wordpress-remote testing
 * This file is run before each test file is executed
 */

import { jest } from '@jest/globals';

// Extend Jest matchers for OAuth and API testing
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidOAuthToken(): R;
      toBeExpiredToken(): R;
      toHaveValidSignature(): R;
      toBeValidWordPressResponse(): R;
      toMatchMCPSchema(): R;
    }
  }
}

// Custom matcher for OAuth token validation
expect.extend({
  toBeValidOAuthToken(received: any) {
    const pass = received &&
      typeof received.access_token === 'string' &&
      received.access_token.length > 0 &&
      typeof received.token_type === 'string' &&
      typeof received.obtained_at === 'number' &&
      received.obtained_at > 0;

    if (pass) {
      return {
        message: () => `expected ${JSON.stringify(received)} not to be a valid OAuth token`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${JSON.stringify(received)} to be a valid OAuth token with access_token, token_type, and obtained_at`,
        pass: false,
      };
    }
  },

  toBeExpiredToken(received: any) {
    if (!received || typeof received.obtained_at !== 'number' || typeof received.expires_in !== 'number') {
      return {
        message: () => `expected ${JSON.stringify(received)} to have obtained_at and expires_in properties`,
        pass: false,
      };
    }

    const now = Date.now();
    const expiryTime = received.obtained_at + (received.expires_in * 1000);
    const pass = expiryTime < now;

    if (pass) {
      return {
        message: () => `expected token not to be expired`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected token to be expired`,
        pass: false,
      };
    }
  },

  toHaveValidSignature(received: any) {
    const pass = received &&
      typeof received === 'string' &&
      received.length === 64 && // SHA-256 hex string
      /^[a-f0-9]+$/.test(received);

    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid SHA-256 signature`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid SHA-256 signature (64 char hex string)`,
        pass: false,
      };
    }
  },

  toBeValidWordPressResponse(received: any) {
    const pass = received &&
      typeof received === 'object' &&
      received.status !== undefined &&
      (received.data !== undefined || received.error !== undefined);

    if (pass) {
      return {
        message: () => `expected ${JSON.stringify(received)} not to be a valid WordPress response`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${JSON.stringify(received)} to be a valid WordPress response with status and data/error`,
        pass: false,
      };
    }
  },

  toMatchMCPSchema(received: any) {
    const pass = received &&
      typeof received === 'object' &&
      received.jsonrpc === '2.0' &&
      (received.id !== undefined || received.method !== undefined);

    if (pass) {
      return {
        message: () => `expected ${JSON.stringify(received)} not to match MCP schema`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${JSON.stringify(received)} to match MCP schema with jsonrpc: '2.0' and id or method`,
        pass: false,
      };
    }
  },
});

// Global test configuration
beforeAll(async () => {
  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.MCP_WP_LOG_LEVEL = 'error'; // Reduce log noise during tests
  
  // Mock console methods to reduce test output noise
  const originalConsole = global.console;
  global.console = {
    ...originalConsole,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: originalConsole.error, // Keep errors visible
  };
});

beforeEach(() => {
  // Clear all mocks before each test
  jest.clearAllMocks();
  
  // Reset environment variables
  delete process.env.MCP_WP_CLIENT_ID;
  delete process.env.MCP_WP_CLIENT_SECRET;
  delete process.env.MCP_WP_SITE_URL;
  delete process.env.MCP_WP_USERNAME;
  delete process.env.MCP_WP_APP_PASSWORD;
});

afterEach(() => {
  // Clean up any test artifacts
  jest.restoreAllMocks();
});

// Global timeout for async operations
jest.setTimeout(30000);

export {};
