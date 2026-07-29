/**
 * Regression coverage for implicit OAuth waits. The operation budget must bound
 * callers even though a lock may remain valid longer for coordination purposes.
 */

import { jest } from '@jest/globals';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import tmp from 'tmp';
import { mockEnv } from '../utils/test-helpers.js';

describe('implicit OAuth timeout budgets', () => {
  let tempDir: string;
  let restoreEnv: () => void;

  beforeEach(() => {
    tempDir = tmp.dirSync({ unsafeCleanup: true }).name;
    restoreEnv = mockEnv({
      WP_MCP_CONFIG_DIR: tempDir,
      OAUTH_TIMEOUT_MS: '100',
      WP_API_URL: 'https://example.com',
    });
    jest.resetModules();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    restoreEnv();
  });

  it('times out an absent callback using the provider operation budget', async () => {
    const { PersistentWPOAuthClientProvider } = await import(
      '../../src/lib/persistent-oauth-client-provider.js'
    );
    const provider = new PersistentWPOAuthClientProvider({
      serverUrl: 'https://example.com',
      timeout: 50,
    });
    const waiting = (provider as any).waitForAuthorizationResult();
    const result = waiting.catch((error: unknown) => error);

    await jest.advanceTimersByTimeAsync(49);
    let settled = false;
    void result.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toMatchObject({ code: 'TIMEOUT' });
  });

  it('continues to accept a successful interactive callback before the deadline', async () => {
    const { PersistentWPOAuthClientProvider } = await import(
      '../../src/lib/persistent-oauth-client-provider.js'
    );
    const provider = new PersistentWPOAuthClientProvider({
      serverUrl: 'https://example.com',
      timeout: 50,
    });
    const tokens = { access_token: 'interactive-token', token_type: 'Bearer' };
    const waiting = (provider as any).waitForAuthorizationResult();

    (provider as any).events.emit('oauth-success', tokens);

    await expect(waiting).resolves.toEqual(tokens);
  });

  it('bounds a secondary process lock wait by the OAuth operation budget', async () => {
    const { WPAuthCoordinator } = await import('../../src/lib/coordination.js');
    const { getConfigDir } = await import('../../src/lib/persistent-auth-config.js');
    const hash = 'implicit-oauth-timeout';
    fs.mkdirSync(getConfigDir(), { recursive: true });
    fs.writeFileSync(
      path.join(getConfigDir(), `${hash}_auth.lock`),
      JSON.stringify({ pid: process.pid, port: 0, timestamp: Date.now(), hostname: 'test' })
    );
    const coordinator = new WPAuthCoordinator(
      hash,
      'https://example.com',
      7665,
      new EventEmitter()
    );
    const waiting = (coordinator as any).lockManager.waitForRelease();
    const result = waiting.catch((error: unknown) => error);

    await jest.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toMatchObject({ code: 'LOCK_TIMEOUT' });
  });
});
