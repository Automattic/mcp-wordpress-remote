/**
 * Global setup for Playwright E2E tests
 */

import { chromium, FullConfig } from '@playwright/test';
import { mockEnv, createTempDir } from '../utils/test-helpers.js';

async function globalSetup(config: FullConfig) {
  console.log('Setting up E2E test environment...');

  // Create temporary directory for test auth storage
  const tempDir = await createTempDir('e2e-test-');

  // Set up test environment variables
  process.env.WP_API_URL = 'https://test-site.com';
  process.env.WP_OAUTH_CLIENT_ID = 'e2e_test_client_id';
  process.env.WP_OAUTH_CLIENT_SECRET = 'e2e_test_client_secret';
  process.env.OAUTH_CALLBACK_PORT = '7665';
  process.env.OAUTH_HOST = '127.0.0.1';
  process.env.WP_MCP_CONFIG_DIR = tempDir;
  process.env.NODE_ENV = 'test';
  process.env.MCP_WP_LOG_LEVEL = 'error'; // Reduce log noise

  // Store temp dir for cleanup
  process.env.E2E_TEMP_DIR = tempDir;

  // Set up mock WordPress API server if needed
  // This would start a mock server for testing OAuth flows
  
  console.log('E2E test environment setup complete');
}

export default globalSetup;
