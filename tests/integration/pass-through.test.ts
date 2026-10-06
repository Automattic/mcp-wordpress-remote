import { spawn, ChildProcess } from 'node:child_process';
import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';
import { once } from 'node:events';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { connect } from 'node:net';

const PROXY_PATH = process.env.PROXY_TEST_PATH || join(process.cwd(), 'dist/proxy.js');

class Client {
  readonly process: ChildProcess;
  private messages: any[] = [];
  private waiters: Array<() => void> = [];
  stderr = '';

  constructor(url: string, env: Record<string, string> = {}) {
    const args =
      env.EMBED_HOOK_TEST === 'true'
        ? [
            '--input-type=module',
            '-e',
            `
      const { registerToolCallHook, wpRequest } = await import(${JSON.stringify(pathToFileURL(join(PROXY_PATH, '..', 'lib.js')).href)});
      registerToolCallHook(async ({ name }) => {
        if (name === 'fixture') await wpRequest({ method: 'tools/call', name: 'telemetry', arguments: { event: 'fixture' } });
      });
      await import(${JSON.stringify(pathToFileURL(PROXY_PATH).href)});
    `,
          ]
        : [PROXY_PATH];
    this.process = spawn(process.execPath, args, {
      env: {
        ...process.env,
        WP_API_URL: url,
        JWT_TOKEN: 'fixture-token',
        OAUTH_ENABLED: 'false',
        USE_SYSTEM_PROXY: 'false',
        CUSTOM_HEADERS: '',
        WP_API_INIT_TIMEOUT_MS: '500',
        WP_API_TIMEOUT_MS: '2000',
        LOG_LEVEL: '0',
        LOG_FILE: '',
        ...env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let buffer = '';
    this.process.stdout!.on('data', chunk => {
      buffer += chunk.toString();
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line) this.messages.push(JSON.parse(line));
      }
      this.waiters.splice(0).forEach(wake => wake());
    });
    this.process.stderr!.on('data', chunk => {
      this.stderr += chunk.toString();
    });
  }

  send(message: object) {
    this.process.stdin!.write(JSON.stringify(message) + '\n');
  }

  async next(predicate: (message: any) => boolean): Promise<any> {
    const deadline = Date.now() + 5000;
    while (true) {
      const index = this.messages.findIndex(predicate);
      if (index !== -1) return this.messages.splice(index, 1)[0];
      if (Date.now() >= deadline) throw new Error(`Missing response; stderr: ${this.stderr}`);
      await new Promise<void>(resolve => {
        const wake = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          this.waiters = this.waiters.filter(waiter => waiter !== wake);
          resolve();
        }, 50);
        this.waiters.push(wake);
      });
    }
  }

  async request(id: number | string, method: string, params?: object) {
    this.send({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
    return this.next(message => message.id === id && !message.method);
  }

  async stop() {
    if (this.process.exitCode !== null || this.process.signalCode !== null) return;
    const exit = once(this.process, 'exit');
    this.process.kill();
    await exit;
  }
}

function json(res: ServerResponse, message: object, status = 200, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(message));
}

function initialize(version = '2025-11-25') {
  return {
    protocolVersion: version,
    clientInfo: { name: 'fixture-client', version: '1', extension: 'preserve' },
    capabilities: { tools: {}, extension: { opaque: true } },
    _meta: { clientExtension: true },
  };
}

describe('built proxy pass-through', () => {
  let server: Server;
  let client: Client;
  let received: Array<{ message: any; headers: IncomingMessage['headers']; method?: string }>;
  let respond: (req: IncomingMessage, res: ServerResponse, message: any) => void;

  beforeEach(async () => {
    received = [];
    respond = (_req, res, message) =>
      json(res, {
        jsonrpc: '2.0',
        id: message.id,
        result:
          message.method === 'initialize'
            ? {
                protocolVersion: message.params.protocolVersion,
                serverInfo: { name: 'fixture', version: '1' },
                capabilities: {},
              }
            : { received: message.params },
      });
    server = createServer(async (req, res) => {
      if (req.method === 'GET') {
        res.writeHead(405);
        res.end();
        return;
      }
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const message = JSON.parse(raw);
      received.push({ message, headers: req.headers, method: req.method });
      respond(req, res, message);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as { port: number }).port;
    client = new Client(`http://127.0.0.1:${port}/mcp`, {
      CUSTOM_HEADERS: '{"MCP-Protocol-Version":"configured-wrong-version","X-Custom":"preserve"}',
    });
  });

  afterEach(async () => {
    if (client) await client.stop();
    if (server) {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('forwards the actual handshake, id zero, opaque metadata and arbitrary methods unchanged', async () => {
    const params = initialize('2099-01-01');
    const result = {
      protocolVersion: '2099-01-02',
      serverInfo: { name: 'fixture', version: '1', extension: 'opaque' },
      capabilities: { extension: { enabled: true } },
      _meta: { serverExtension: true },
      extra: { preserve: true },
    };
    respond = (_req, res, message) =>
      json(
        res,
        {
          jsonrpc: '2.0',
          id: message.id,
          result: message.method === 'initialize' ? result : { received: message.params },
        },
        200,
        { 'Mcp-Session-Id': 'fixture-session' }
      );

    expect(await client.request(0, 'initialize', params)).toEqual({
      jsonrpc: '2.0',
      id: 0,
      result,
    });
    const extension = { value: 42, _meta: { progressToken: 0, extra: true } };
    expect(await client.request('extension', 'vendor/extension', extension)).toEqual({
      jsonrpc: '2.0',
      id: 'extension',
      result: { received: extension },
    });
    expect(received.map(entry => entry.message)).toEqual([
      { jsonrpc: '2.0', id: 0, method: 'initialize', params },
      { jsonrpc: '2.0', id: 'extension', method: 'vendor/extension', params: extension },
    ]);
    expect(received[0].headers['mcp-protocol-version']).toBe('2099-01-01');
    expect(received[1].headers['mcp-protocol-version']).toBe('2099-01-02');
    expect(received[1].headers['mcp-session-id']).toBe('fixture-session');
    expect(received[1].headers['x-custom']).toBe('preserve');
    expect(received[1].headers.authorization).toBe('Bearer fixture-token');
  });

  it('does not forward eager follow-up requests before initialization responds', async () => {
    await client.stop();
    const port = (server.address() as { port: number }).port;
    client = new Client(`http://127.0.0.1:${port}/mcp`, { LOG_LEVEL: '3', LOG_TO_STDERR: 'true' });
    respond = (_req, res, message) => {
      const reply = () =>
        json(
          res,
          {
            jsonrpc: '2.0',
            id: message.id,
            result:
              message.method === 'initialize'
                ? {
                    protocolVersion: '2025-06-18',
                    serverInfo: { name: 'fixture', version: '1' },
                    capabilities: { tools: {} },
                  }
                : { tools: [] },
          },
          200,
          { 'Mcp-Session-Id': 'ready-session' }
        );
      if (message.method === 'initialize') {
        setTimeout(() => {
          expect(received).toHaveLength(1);
          reply();
        }, 80);
      } else reply();
    };
    const init = client.request(1, 'initialize', initialize());
    const tools = client.request(2, 'tools/list', { _meta: { extra: true } });
    await init;
    expect((await tools).result).toEqual({ tools: [] });
    expect(received[1].headers['mcp-protocol-version']).toBe('2025-06-18');
    expect(received[1].headers['mcp-session-id']).toBe('ready-session');
    const settled = client.stderr.indexOf('Upstream initialization settled');
    expect(settled).toBeGreaterThanOrEqual(0);
    expect(client.stderr.indexOf('Forwarding client message: tools/list')).toBeGreaterThan(settled);
  });

  it('forwards SSE progress, server requests and client replies without waiting for EOF', async () => {
    let stream: ServerResponse;
    const notification = {
      jsonrpc: '2.0',
      method: 'notifications/progress',
      params: { progressToken: 'p', progress: 1, _meta: { extra: true } },
    };
    const serverRequest = {
      jsonrpc: '2.0',
      id: 'server-1',
      method: 'elicitation/create',
      params: { message: 'fixture', custom: true },
    };
    respond = (_req, res, message) => {
      if (message.method === 'initialize') {
        json(res, {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: '2025-11-25',
            serverInfo: { name: 'fixture', version: '1' },
            capabilities: {},
          },
        });
      } else if (message.method === 'notifications/initialized') {
        res.writeHead(202);
        res.end();
      } else if (message.method === 'tools/call') {
        stream = res;
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify(notification)}\n\n`);
        res.write(`event: message\ndata: ${JSON.stringify(serverRequest)}\n\n`);
      } else {
        res.writeHead(202);
        res.end();
        stream.end(
          `data: ${JSON.stringify({ jsonrpc: '2.0', id: 'tool-1', result: { content: [], _meta: { extra: true } } })}\n\n`
        );
      }
    };
    await client.request(1, 'initialize', initialize());
    client.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const tool = client.request('tool-1', 'tools/call', {
      name: 'fixture',
      arguments: {},
      _meta: { progressToken: 'p' },
    });
    expect(await client.next(message => message.method === notification.method)).toEqual(
      notification
    );
    expect(await client.next(message => message.id === 'server-1')).toEqual(serverRequest);
    const reply = {
      jsonrpc: '2.0',
      id: 'server-1',
      result: { action: 'accept', content: { value: 1 } },
    };
    client.send(reply);
    expect((await tool).result).toEqual({ content: [], _meta: { extra: true } });
    expect(received.map(entry => entry.message)).toContainEqual(reply);
    expect(received.map(entry => entry.message)).toContainEqual({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
  });

  it.each([200, 400])(
    'preserves upstream JSON-RPC error code, data and id on HTTP %s',
    async status => {
      const response = {
        jsonrpc: '2.0',
        id: 'error-1',
        error: {
          code: -32022,
          message: 'Unsupported protocol version',
          data: { supported: ['other-version'], opaque: true },
        },
      };
      respond = (_req, res) => json(res, response, status);
      expect(
        await client.request('error-1', 'server/discover', {
          _meta: { 'io.modelcontextprotocol/protocolVersion': '2099-01-01' },
        })
      ).toEqual(response);
    }
  );

  it('forwards metadata-based requests without initializing and derives headers per request', async () => {
    const params = {
      name: 'café',
      arguments: { value: 1 },
      _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientInfo': { name: 'fixture', version: '1' },
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    };
    expect((await client.request(0, 'tools/call', params)).result).toEqual({ received: params });
    expect(received).toHaveLength(1);
    expect(received[0].headers['mcp-protocol-version']).toBe('2026-07-28');
    expect(received[0].headers['mcp-method']).toBe('tools/call');
    expect(received[0].headers['mcp-name']).toBe('=?base64?Y2Fmw6k=?=');
    await client.request(1, 'vendor/extension', {
      _meta: { 'io.modelcontextprotocol/protocolVersion': '2099-02-03' },
    });
    expect(received[1].headers['mcp-protocol-version']).toBe('2099-02-03');
  });

  it('mirrors x-mcp-header tool arguments into Mcp-Param headers on 2026 tool calls', async () => {
    const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' };
    const tool = {
      name: 'query',
      inputSchema: {
        type: 'object',
        properties: {
          region: { type: 'string', 'x-mcp-header': 'Region' },
          options: {
            type: 'object',
            properties: {
              limit: { type: 'integer', 'x-mcp-header': 'Limit' },
              label: { type: 'string', 'x-mcp-header': 'Label' },
            },
          },
          absent: { type: 'boolean', 'x-mcp-header': 'Absent' },
        },
      },
    };
    respond = (_req, res, message) =>
      json(res, {
        jsonrpc: '2.0',
        id: message.id,
        result: message.method === 'tools/list' ? { tools: [tool] } : { content: [] },
      });
    await client.request(0, 'tools/list', { _meta: meta });
    await client.request(1, 'tools/call', {
      name: 'query',
      arguments: { region: 'us-west1', options: { limit: 42, label: 'café' } },
      _meta: meta,
    });
    const headers = received[1].headers;
    expect(headers['mcp-name']).toBe('query');
    expect(headers['mcp-param-region']).toBe('us-west1');
    expect(headers['mcp-param-limit']).toBe('42');
    expect(headers['mcp-param-label']).toBe('=?base64?Y2Fmw6k=?=');
    expect(headers['mcp-param-absent']).toBeUndefined();
    expect(received[0].headers['mcp-name']).toBeUndefined();
  });

  it('cancels a 2026 request by closing its stream instead of forwarding notifications/cancelled', async () => {
    const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' };
    const closed = new Promise<void>(resolve => {
      respond = (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(': open\n\n');
        res.on('close', () => resolve());
      };
    });
    client.send({
      jsonrpc: '2.0',
      id: 'slow',
      method: 'tools/call',
      params: { name: 'slow', arguments: {}, _meta: meta },
    });
    while (received.length === 0) await new Promise(resolve => setTimeout(resolve, 10));
    client.send({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 'slow', _meta: meta },
    });
    await closed;
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(received.map(entry => entry.message.method)).toEqual(['tools/call']);
    expect(client.stderr).not.toMatch(/timed out/);
  });

  it('preserves the 2026 native elicitation result and continuation fields', async () => {
    const question = {
      resultType: 'input_required',
      inputRequests: {
        confirm: {
          method: 'elicitation/create',
          params: {
            mode: 'form',
            message: 'Run the harmless echo fixture?',
            requestedSchema: {
              type: 'object',
              properties: { allow: { type: 'boolean' } },
              required: ['allow'],
            },
          },
        },
      },
      requestState: 'opaque-server-signed-state',
    };
    const call = {
      name: 'execute-ability',
      arguments: { name: 'e2e-consent/echo-note', input: { note: 'fixture' } },
      _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientInfo': { name: 'claude-fixture', version: '1' },
        'io.modelcontextprotocol/clientCapabilities': { elicitation: { form: {}, url: {} } },
      },
    };
    const complete = { resultType: 'complete', structuredContent: { note: 'fixture' } };
    respond = (_req, res, message) =>
      json(res, {
        jsonrpc: '2.0',
        id: message.id,
        result: message.params.requestState ? complete : question,
      });
    expect((await client.request(0, 'tools/call', call)).result).toEqual(question);
    const continuation = {
      ...call,
      requestState: question.requestState,
      inputResponses: { confirm: { action: 'accept', content: { allow: true } } },
    };
    expect((await client.request(1, 'tools/call', continuation)).result).toEqual(complete);
    expect(received[1].message.params).toEqual(continuation);
    expect(received[1].headers['mcp-protocol-version']).toBe('2026-07-28');
    expect(received[1].headers['mcp-method']).toBe('tools/call');
    expect(received[1].headers['mcp-name']).toBe('execute-ability');
  });

  it('shares the live authenticated session with hooks and the separate /lib bundle', async () => {
    await client.stop();
    const port = (server.address() as { port: number }).port;
    client = new Client(`http://127.0.0.1:${port}/mcp`, { EMBED_HOOK_TEST: 'true' });
    let complete: () => void;
    const telemetry = new Promise<void>(resolve => {
      complete = resolve;
    });
    respond = (_req, res, message) => {
      if (message.method === 'initialize')
        json(
          res,
          {
            jsonrpc: '2.0',
            id: message.id,
            result: {
              protocolVersion: '2025-06-18',
              serverInfo: { name: 'fixture', version: '1' },
              capabilities: {},
            },
          },
          200,
          { 'Mcp-Session-Id': 'hook-session' }
        );
      else {
        json(res, { jsonrpc: '2.0', id: message.id, result: { content: [] } });
        if (message.params.name === 'telemetry') complete();
      }
    };
    await client.request(0, 'initialize', initialize());
    expect(
      (await client.request(1, 'tools/call', { name: 'fixture', arguments: {} })).result
    ).toEqual({ content: [] });
    let timer: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([
        telemetry,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('missing hook request')), 3000);
        }),
      ]);
    } finally {
      clearTimeout(timer!);
    }
    expect(received[2].message).toMatchObject({
      method: 'tools/call',
      params: { name: 'telemetry', arguments: { event: 'fixture' } },
    });
    expect(received[2].headers['mcp-session-id']).toBe('hook-session');
    expect(received[2].headers['mcp-protocol-version']).toBe('2025-06-18');
    expect(received.filter(entry => entry.message.method === 'initialize')).toHaveLength(1);
  });

  it.each([
    [
      {
        JWT_TOKEN: '',
        WP_API_USERNAME: 'fixture-user',
        WP_API_PASSWORD: 'fixture-password',
        CUSTOM_HEADERS: '',
      },
      'Basic ' + Buffer.from('fixture-user:fixture-password').toString('base64'),
    ],
    [
      {
        JWT_TOKEN: '',
        WP_API_USERNAME: '',
        WP_API_PASSWORD: '',
        CUSTOM_HEADERS: '{"authorization":"Bearer custom-token"}',
      },
      'Bearer custom-token',
    ],
    [
      { JWT_TOKEN: 'fixture-token', CUSTOM_HEADERS: '{"authorization":"Bearer ignored-token"}' },
      'Bearer fixture-token',
    ],
  ])('keeps authentication options usable: %j', async (env, authorization) => {
    await client.stop();
    const port = (server.address() as { port: number }).port;
    client = new Client(`http://127.0.0.1:${port}/mcp`, env as Record<string, string>);
    await client.request(0, 'initialize', initialize());
    expect(received[0].headers.authorization).toBe(authorization);
  });

  it('bounds a stalled initialization and never retries it in another request format', async () => {
    respond = () => {};
    const init = await client.request(0, 'initialize', initialize('2099-01-01'));
    expect(init.result.protocolVersion).toBe('2099-01-01');
    expect(init.result.capabilities.experimental.connectionFailed.code).toBe('ETIMEDOUT');
    const tools = await client.request(1, 'tools/list', {});
    expect(tools.error.data.reason).toBe('failed');
    expect(received).toHaveLength(1);
  });

  it('reports malformed HTTP chunk framing with the underlying cause', async () => {
    await client.request(0, 'initialize', initialize());
    respond = (_req, res) => {
      res.socket!.end(
        'HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\nevent: message\ndata: {}\n\n'
      );
    };
    const response = await client.request(1, 'tools/list', {});
    expect(response.error.data.code).toBe('HPE_INVALID_CHUNK_SIZE');
    expect(response.result).toBeUndefined();
  });

  it('streams SSE through the retained system HTTP proxy option', async () => {
    const tunnel = createServer();
    const sockets = new Set<import('node:stream').Duplex>();
    let connects = 0;
    tunnel.on('connect', (req, socket, head) => {
      connects++;
      const [host, port] = req.url!.split(':');
      const upstream = connect(Number(port), host, () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        upstream.pipe(socket);
        socket.pipe(upstream);
      });
      sockets.add(upstream);
      sockets.add(socket);
      upstream.on('error', () => socket.destroy());
      socket.on('error', () => upstream.destroy());
    });
    tunnel.listen(0, '127.0.0.1');
    await once(tunnel, 'listening');
    try {
      await client.stop();
      const port = (server.address() as { port: number }).port;
      const tunnelPort = (tunnel.address() as { port: number }).port;
      client = new Client(`http://127.0.0.1:${port}/mcp`, {
        USE_SYSTEM_PROXY: 'true',
        SOCKS_PROXY: '',
        socks_proxy: '',
        NO_PROXY: '',
        no_proxy: '',
        HTTPS_PROXY: `http://127.0.0.1:${tunnelPort}`,
      });
      respond = (_req, res, message) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end(
          `data: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-11-25', serverInfo: { name: 'fixture', version: '1' }, capabilities: {} } })}\n\n`
        );
      };
      expect((await client.request(0, 'initialize', initialize())).result.serverInfo.name).toBe(
        'fixture'
      );
      expect(connects).toBeGreaterThan(0);
      expect(received[0].headers.authorization).toBe('Bearer fixture-token');
    } finally {
      await client.stop();
      sockets.forEach(socket => socket.destroy());
      await new Promise<void>(resolve => tunnel.close(() => resolve()));
    }
  });
});
