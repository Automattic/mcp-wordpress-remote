/**
 * Global teardown for Playwright E2E tests
 */

import { FullConfig } from '@playwright/test';
import { cleanupTempDir } from '../utils/test-helpers.js';

async function globalTeardown(config: FullConfig) {
  console.log('Cleaning up E2E test environment...');

  // Clean up temporary directory
  if (process.env.E2E_TEMP_DIR) {
    await cleanupTempDir(process.env.E2E_TEMP_DIR);
  }

  // Clean up any test servers that might be running
  
  console.log('E2E test environment cleanup complete');
}

export default globalTeardown;
