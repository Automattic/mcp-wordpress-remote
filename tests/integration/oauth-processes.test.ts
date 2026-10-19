import { build } from 'esbuild';
import { spawn, ChildProcess } from 'node:child_process';
import { createServer, Server } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { once } from 'node:events';

describe('OAuth across proxy processes', () => {
  let directory: string;
  let bundle: string;
  let server: Server;
  let origin: string;
  let cache: string;
  let hash: string;
  let browsers: number;
  let refreshes: number;
  let grants: number;
  let tokenStatus: number;
  let children: ChildProcess[];
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'oauth-processes-'));
    bundle = join(directory, 'proxy.cjs');
    await build({
      entryPoints: [resolve('src/proxy.ts')],
      outfile: bundle,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      packages: 'external',
      alias: { open: resolve('tests/fixtures/oauth-browser.ts') },
    });
  });

  beforeEach(async () => {
    browsers = refreshes = grants = 0;
    tokenStatus = 200;
    children = [];
    cache = mkdtempSync(join(directory, 'cache-'));
    server = createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/.well-known/oauth-protected-resource') {
        response.end(
          JSON.stringify({ resource: `${origin}/mcp`, authorization_servers: [origin] })
        );
      } else if (request.url === '/.well-known/oauth-authorization-server') {
        response.end(
          JSON.stringify({
            issuer: origin,
            authorization_endpoint: `${origin}/authorize`,
            token_endpoint: `${origin}/token`,
            response_types_supported: ['code'],
            token_endpoint_auth_methods_supported: ['none'],
          })
        );
      } else if (request.url === '/token') {
        if (tokenStatus !== 200) {
          refreshes++;
          setTimeout(() => {
            response.statusCode = tokenStatus;
            response.end(JSON.stringify({ error: 'server_error' }));
          }, 400);
          return;
        }
        const params = new URLSearchParams(body);
        if (params.get('grant_type') === 'refresh_token') refreshes++;
        else grants++;
        setTimeout(
          () =>
            response.end(
              JSON.stringify({
                access_token: 'fixture-access',
                refresh_token: 'rotated-refresh',
                token_type: 'Bearer',
                expires_in: 3600,
              })
            ),
          150
        );
      } else {
        const rpc = JSON.parse(body);
        response.setHeader('Mcp-Session-Id', 'fixture-session');
        response.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpc.id,
            result: {
              protocolVersion: '2025-06-18',
              capabilities: { tools: {} },
              serverInfo: { name: 'fixture', version: '1' },
            },
          })
        );
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server');
    origin = `http://127.0.0.1:${address.port}`;
    hash = createHash('md5').update(`${origin}/mcp`).digest('hex');
    mkdirSync(join(cache, `wordpress-remote-${version}`));
    writeFileSync(
      credentialFile('client_info.json'),
      JSON.stringify({ client_id: 'fixture-client' })
    );
  });

  afterEach(async () => {
    await Promise.all(
      children.map(async child => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const closed = once(child, 'close');
        child.kill('SIGTERM');
        await closed;
      })
    );
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  function credentialFile(name: string) {
    return join(cache, `wordpress-remote-${version}`, `${hash}_${name}`);
  }

  function expired() {
    writeFileSync(
      credentialFile('tokens.json'),
      JSON.stringify({
        access_token: 'expired-access',
        refresh_token: 'fixture-refresh',
        expires_in: 1,
        obtained_at: Date.now() - 120000,
        token_type: 'Bearer',
      })
    );
  }

  function connect(): Promise<void> {
    const child = spawn(process.execPath, [bundle], {
      env: {
        ...process.env,
        NODE_PATH: resolve('node_modules'),
        WP_MCP_CONFIG_DIR: cache,
        WP_API_URL: `${origin}/mcp`,
        OAUTH_ENABLED: 'true',
        WP_OAUTH_CLIENT_ID: 'fixture-client',
        OAUTH_CALLBACK_PORT: '',
        OAUTH_TIMEOUT_MS: '5000',
        LOG_FILE: '',
        LOG_LEVEL: '0',
        JWT_TOKEN: '',
        WP_API_USERNAME: '',
        WP_API_PASSWORD: '',
        CUSTOM_HEADERS: '',
        USE_SYSTEM_PROXY: 'false',
        SOCKS_PROXY: '',
        HTTP_PROXY: '',
        HTTPS_PROXY: '',
        ALL_PROXY: '',
      },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });
    children.push(child);
    child.on('message', message => {
      if ((message as { kind?: string }).kind === 'browser') browsers++;
    });
    return new Promise((resolve, reject) => {
      let buffer = '',
        stderr = '';
      const timer = setTimeout(() => reject(new Error(`Proxy timed out: ${stderr}`)), 8000);
      child.stderr!.on('data', chunk => (stderr += String(chunk)));
      child.once('error', error => {
        clearTimeout(timer);
        reject(error);
      });
      child.stdout!.on('data', chunk => {
        buffer += String(chunk);
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          const rpc = JSON.parse(line);
          if (rpc.id === 1) {
            clearTimeout(timer);
            if (rpc.error) reject(new Error(JSON.stringify(rpc.error)));
            else if (rpc.result?.serverInfo?.name !== 'fixture')
              reject(new Error('Proxy returned degraded initialization'));
            else resolve();
          }
        }
      });
      child.stdin!.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'fixture', version: '1' },
          },
        }) + '\n'
      );
    });
  }

  it('keeps expired refreshable credentials at startup and renews once for three processes', async () => {
    expired();
    await Promise.all([connect(), connect(), connect()]);
    expect(refreshes).toBe(1);
    expect(browsers).toBe(0);
    expect(grants).toBe(0);
    expect(JSON.parse(readFileSync(credentialFile('tokens.json'), 'utf8')).refresh_token).toBe(
      'rotated-refresh'
    );
  });

  it('opens one browser for three processes without tokens', async () => {
    await Promise.all([connect(), connect(), connect()]);
    expect(browsers).toBe(1);
    expect(grants).toBe(1);
    expect(refreshes).toBe(0);
  });

  it('does not turn a failed shared refresh into successive login attempts', async () => {
    expired();
    tokenStatus = 503;
    const before = readFileSync(credentialFile('tokens.json'), 'utf8');
    const results = await Promise.allSettled([connect(), connect(), connect()]);
    expect(results.every(result => result.status === 'rejected')).toBe(true);
    expect(refreshes).toBe(1);
    expect(browsers).toBe(0);
    expect(readFileSync(credentialFile('tokens.json'), 'utf8')).toBe(before);
  });

  it('recovers a stale lock left by an absent owner', async () => {
    expired();
    const lock = credentialFile('oauth.lock');
    mkdirSync(lock);
    const past = new Date(Date.now() - 60000);
    utimesSync(lock, past, past);
    await connect();
    expect(refreshes).toBe(1);
    expect(browsers).toBe(0);
  });
});
