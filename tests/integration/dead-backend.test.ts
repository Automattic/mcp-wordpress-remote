/**
 * Integration test: dead backend regression
 *
 * Spawns the actual proxy as a child process, sends MCP messages over stdio,
 * and verifies the exact failure path from the 0.2.20 race condition:
 *
 *   1. Client sends initialize → proxy tries to reach WordPress → fails
 *   2. Proxy returns fallback init with empty capabilities
 *   3. Client sends tools/list anyway → proxy returns clean MCP error
 *      (NOT a malformed request forwarded to a dead backend)
 *
 * This is a true end-to-end smoke test: it exercises the built artifact
 * (dist/proxy.js), not source imports.
 */

import { spawn, ChildProcess } from 'child_process';
import { once } from 'events';
import { join } from 'path';
import { InitializeResultSchema } from '@modelcontextprotocol/sdk/types.js';

const PROXY_PATH = join(process.cwd(), 'dist/proxy.js');

/** Send a JSON-RPC message to the proxy's stdin (newline-delimited). */
function send(proc: ChildProcess, message: object): void {
  proc.stdin!.write(JSON.stringify(message) + '\n');
}

/**
 * Collect newline-delimited JSON messages from stdout until we have `count` of them,
 * or timeout after `ms` milliseconds.
 */
function collectMessages(proc: ChildProcess, count: number, ms = 15_000): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const messages: any[] = [];
    let buffer = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out after ${ms}ms waiting for ${count} message(s), got ${messages.length}: ${JSON.stringify(messages)}`));
    }, ms);

    function onData(chunk: Buffer) {
      buffer += chunk.toString();
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try {
          messages.push(JSON.parse(line));
        } catch {
          // skip non-JSON lines (e.g. log output leaked to stdout)
        }
        if (messages.length >= count) {
          cleanup();
          resolve(messages);
          return;
        }
      }
    }

    function cleanup() {
      clearTimeout(timer);
      proc.stdout!.off('data', onData);
    }

    proc.stdout!.on('data', onData);
  });
}

describe('dead backend integration', () => {
  let proxy: ChildProcess;

  afterEach(() => {
    if (proxy && !proxy.killed) {
      proxy.kill();
    }
  });

  it('returns fallback init and rejects tools/list when WordPress is unreachable', async () => {
    // Spawn the built proxy pointed at a host that will never connect.
    // Using 192.0.2.1 (TEST-NET, RFC 5737) — guaranteed unroutable, no DNS lookup.
    proxy = spawn('node', [PROXY_PATH], {
      env: {
        ...process.env,
        WP_API_URL: 'http://192.0.2.1:1',
        JWT_TOKEN: 'test-dead-backend-token',
        LOG_LEVEL: '0',     // suppress logs on stderr
        NODE_ENV: 'test',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Drain stderr so the child doesn't block
    proxy.stderr!.resume();

    // Wait for the process to be ready (give it a moment to boot)
    await new Promise(r => setTimeout(r, 200));

    // 1. Send initialize
    send(proxy, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        clientInfo: { name: 'dead-backend-test', version: '1.0.0' },
        capabilities: {},
      },
    });

    // Collect the initialize response
    const [initResponse] = await collectMessages(proxy, 1);

    expect(initResponse).toHaveProperty('jsonrpc', '2.0');
    expect(initResponse).toHaveProperty('id', 1);
    expect(initResponse.result).toBeDefined();

    // The dead connection advertises NO real capabilities — listing tools/
    // logging/etc. would make an eager client call them during setup and fail
    // before it can read the degraded flag.
    const caps = initResponse.result.capabilities;
    expect(caps.tools).toBeUndefined();
    expect(caps.resources).toBeUndefined();
    expect(caps.prompts).toBeUndefined();
    expect(caps.logging).toBeUndefined();
    expect(caps.completions).toBeUndefined();

    // Instructions should indicate failure
    expect(initResponse.result.instructions).toMatch(/Connection Failed/i);

    // Clients can detect the degraded state programmatically (issue #61)
    // instead of string-matching the instructions field. The value must be an
    // object — the MCP ServerCapabilities schema rejects a boolean here.
    expect(caps.experimental?.connectionFailed).toBeDefined();
    expect(typeof caps.experimental.connectionFailed).toBe('object');

    // The fallback initialize result must satisfy the SDK schema, or a strict
    // client would reject the degraded handshake outright.
    expect(() => InitializeResultSchema.parse(initResponse.result)).not.toThrow();

    // 2. Send initialized notification (required by MCP protocol before requests)
    send(proxy, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });

    // 3. Send tools/list — this is the exact request that triggered the 0.2.20 bug
    send(proxy, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });

    // Collect the tools/list response
    const [toolsResponse] = await collectMessages(proxy, 1);

    expect(toolsResponse).toHaveProperty('jsonrpc', '2.0');
    expect(toolsResponse).toHaveProperty('id', 2);

    // The response must be a clean MCP error, NOT a forwarded malformed request.
    // The init-ready gate should have caught this and returned an error.
    expect(toolsResponse.error).toBeDefined();
    expect(toolsResponse.error.message).toMatch(/WordPress connection failed during initialization/);

    // The error must carry the underlying cause in `data` so the client can
    // explain why init failed, rather than a bare internal error (issue #61).
    expect(toolsResponse.error.data).toBeDefined();
    expect(toolsResponse.error.data.reason).toBe('failed');
  }, 30_000);

  // Healthy-backend integration test omitted: unit tests cover the happy path.
  // A full test here needs a real or mocked WordPress endpoint in the child process.
});
