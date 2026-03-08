/**
 * Jest setup file for mcp-wordpress-remote testing
 * This file is run before each test file is executed
 */

import { jest } from '@jest/globals';

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
