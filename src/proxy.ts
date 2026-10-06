#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { logger, setupSignalHandlers } from './lib/utils.js';
import { cleanupExpiredTokens } from './lib/persistent-auth-config.js';
import { validateNodeVersion } from './lib/node-utils.js';
import { setupFetchPolyfill } from './lib/fetch-utils.js';
import { createWordPressTransport } from './lib/wordpress-transport.js';
import { startPassThrough } from './lib/pass-through.js';

validateNodeVersion(18);

async function WordPressProxy() {
  await setupFetchPolyfill();
  try {
    await cleanupExpiredTokens();
  } catch (error) {
    logger.warn('Error cleaning up expired tokens', 'PROXY', error);
  }

  const local = new StdioServerTransport();
  let bridge: Awaited<ReturnType<typeof startPassThrough>> | undefined;
  const remote = createWordPressTransport((message, error) => bridge?.fail(message, error));
  bridge = await startPassThrough(local, remote);
  process.stdin.once('end', () => {
    void bridge?.close();
  });
  setupSignalHandlers(bridge.close);
  logger.info('WordPress MCP pass-through proxy ready', 'PROXY');
}

void WordPressProxy().catch(error => {
  logger.error('Error starting WordPress proxy', 'PROXY', error);
  process.exitCode = 1;
});
