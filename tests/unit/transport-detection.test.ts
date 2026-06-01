/**
 * Tests for transport detection.
 *
 * Focus: a timed-out JSON-RPC probe must NOT fall back to simple transport
 * (issue #61) — retrying a stalled upstream just doubles the wait. Other
 * JSON-RPC failures should still fall back to simple transport.
 *
 * Drives the real wordpress-api through nock (same approach as
 * init-ready-gate.test.ts) rather than mocking, so the actual timeout and
 * fallback paths are exercised end to end.
 */

import { jest } from '@jest/globals';
import nock from 'nock';

const WP_HOST = 'https://transport-detect.example.com';
const WP_ENDPOINT = '/?rest_route=/wp/v2/wpmcp';
const INIT_TIMEOUT_MS = 100;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('detectTransportType', () => {
  let detectTransportType: any;

  beforeAll(async () => {
    process.env.WP_API_URL = WP_HOST;
    process.env.JWT_TOKEN = 'test-jwt-for-transport-detection';
    process.env.NODE_ENV = 'test';
    // Short init timeout so the timeout test resolves quickly.
    process.env.WP_API_INIT_TIMEOUT_MS = String(INIT_TIMEOUT_MS);

    jest.resetModules();
    ({ detectTransportType } = await import('../../src/lib/transport-detection.js'));
  });

  afterAll(() => {
    delete process.env.JWT_TOKEN;
    delete process.env.WP_API_INIT_TIMEOUT_MS;
    nock.cleanAll();
  });

  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.abortPendingRequests();
    nock.cleanAll();
  });

  function makeContext(): any {
    return { sessionId: null, requestIdCounter: 0, transportType: null };
  }

  it('does not fall back to simple transport when JSON-RPC times out', async () => {
    // The JSON-RPC probe does not respond within the init timeout. The delay is
    // kept just above the timeout (not seconds) so nock's reply timer fires and
    // clears within this test rather than leaking into the worker teardown.
    const replyDelay = INIT_TIMEOUT_MS + 50;
    nock(WP_HOST)
      .post(WP_ENDPOINT)
      .delay(replyDelay)
      .reply(200, { jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'wp' } } });

    const error: any = await detectTransportType(makeContext(), {}).catch((e: any) => e);

    // The "timed out during initialization" message is only produced on the
    // skip path; the fallback path would say "Unable to establish connection".
    expect(error.message).toMatch(/timed out during initialization/);
    expect(error.cause?.code).toBe('ETIMEDOUT');

    // Let nock's delayed reply timer fire and clear before teardown.
    await sleep(replyDelay + 25);
  });

  it('does not fall back when undici reports a connect timeout (UND_ERR_CONNECT_TIMEOUT)', async () => {
    // undici's own connect deadline can fire before our AbortSignal, surfacing
    // a different code. It is still a timeout and must be treated as terminal.
    const connectError: any = new Error('Connect Timeout Error');
    connectError.code = 'UND_ERR_CONNECT_TIMEOUT';
    nock(WP_HOST).post(WP_ENDPOINT).replyWithError(connectError);

    const error: any = await detectTransportType(makeContext(), {}).catch((e: any) => e);

    expect(error.message).toMatch(/timed out during initialization/);
    expect(error.cause?.code).toBe('UND_ERR_CONNECT_TIMEOUT');
  });

  it('falls back to simple transport when JSON-RPC fails for a non-timeout reason', async () => {
    // First (JSON-RPC) attempt returns a JSON-RPC error, second (simple) succeeds.
    nock(WP_HOST)
      .post(WP_ENDPOINT)
      .reply(200, { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'no jsonrpc' } });
    nock(WP_HOST)
      .post(WP_ENDPOINT)
      .reply(200, { protocolVersion: '2025-06-18', serverInfo: { name: 'wp' } });

    const result = await detectTransportType(makeContext(), {});

    expect(result.transportType).toBe('simple');
  });

  it('uses JSON-RPC transport when the first probe succeeds', async () => {
    nock(WP_HOST)
      .post(WP_ENDPOINT)
      .reply(200, {
        jsonrpc: '2.0',
        id: 1,
        result: { protocolVersion: '2025-06-18', serverInfo: { name: 'wp' } },
      });

    const result = await detectTransportType(makeContext(), {});

    expect(result.transportType).toBe('jsonrpc');
  });
});
