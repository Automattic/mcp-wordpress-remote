/**
 * Regression coverage for OAuth callback startup at the provider/server seam.
 * Express 5 reports a failed bind through the listen callback; the server must
 * reject startup so the provider never opens a browser without a listener.
 */

import { jest } from '@jest/globals';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import tmp from 'tmp';
import nock from 'nock';
import { mockEnv } from '../utils/test-helpers.js';

describe('OAuth authorization startup', () => {
  let tempDir: tmp.DirResult;
  let restoreEnv: () => void;

  beforeEach(() => {
    tempDir = tmp.dirSync({ unsafeCleanup: true });
    restoreEnv = mockEnv({
      WP_MCP_CONFIG_DIR: tempDir.name,
      WP_API_URL: 'https://example.com/mcp',
      OAUTH_ENABLED: 'true',
      OAUTH_TIMEOUT_MS: '100',
      LOG_LEVEL: '0',
    });
    jest.resetModules();
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
    restoreEnv();
    tempDir.removeCallback();
  });

  it('starts a callback listener on an available port', async () => {
    const { OAuthCallbackServer } = await import('../../src/lib/oauth-callback-server.js');
    const server = new OAuthCallbackServer(
      { port: 0, host: '127.0.0.1', serverUrlHash: 'test' },
      new EventEmitter()
    );

    try {
      await server.start();
      expect(server.isRunning()).toBe(true);
    } finally {
      await server.stop();
    }
  });

  it('rejects repeated attempts on an occupied callback port before opening a browser', async () => {
    const holder = createServer();
    await new Promise<void>((resolve, reject) => {
      holder.once('error', reject);
      holder.listen(0, '127.0.0.1', resolve);
    });
    const address = holder.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP listener');

    const { MCPOAuthProvider } = await import('../../src/lib/mcp-oauth-provider.js');
    const { default: open } = await import('open');
    const { logger } = await import('../../src/lib/utils.js');
    jest.spyOn(logger, 'error').mockImplementation(() => {});

    // Keep the real callback server: stubbing start() hides Express 5's
    // error callback, which previously resolved startup despite EADDRINUSE.
    const discovery = nock('https://example.com')
      .get('/.well-known/oauth-protected-resource/mcp')
      .twice()
      .reply(200, {
        resource: 'https://example.com/mcp',
        authorization_servers: ['https://example.com'],
      })
      .get('/.well-known/oauth-authorization-server')
      .twice()
      .reply(200, {
        issuer: 'https://example.com',
        authorization_endpoint: 'https://example.com/authorize',
        token_endpoint: 'https://example.com/token',
        response_types_supported: ['code'],
      });

    try {
      // Two sequential attempts: the second proves a failed bind releases the
      // coordination lock in the config dir, so a retry reaches the bind again
      // instead of waiting on stale state.
      for (let attempt = 0; attempt < 2; attempt++) {
        const provider = new MCPOAuthProvider({
          serverUrl: 'https://example.com/mcp',
          callbackPort: address.port,
          host: '127.0.0.1',
          clientId: 'test-client',
        });
        await expect(provider.authorize()).rejects.toMatchObject({ code: 'EADDRINUSE' });
      }
      expect(open).not.toHaveBeenCalled();
      expect(discovery.isDone()).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => {
        holder.close(error => (error ? reject(error) : resolve()));
      });
    }
  });
});
