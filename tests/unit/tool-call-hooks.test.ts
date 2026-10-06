import { jest } from '@jest/globals';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { WordPressTransport } from '../../src/lib/wordpress-transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

// Transport seam: exercise the real bridge and registry, without repeating HTTP tests.
describe('tool-call hooks', () => {
  let unregister: Array<() => void>;
  let close: () => Promise<void>;
  let local: Transport;
  let remote: WordPressTransport;
  let register: typeof import('../../src/lib/tool-call-hooks.js').registerToolCallHook;
  let requests: JSONRPCMessage[];
  let output: JSONRPCMessage[];
  let response: Record<string, unknown>;

  beforeEach(async () => {
    process.env.WP_API_TIMEOUT_MS = '1000';
    jest.resetModules();
    unregister = [];
    requests = [];
    output = [];
    response = { content: [] };
    register = (await import('../../src/lib/tool-call-hooks.js')).registerToolCallHook;
    local = {
      start: async () => {},
      close: async () => {},
      send: async message => {
        output.push(message);
      },
    };
    remote = {
      start: async () => {},
      close: async () => {},
      setProtocolVersion: () => {},
      cancelRequest: () => {},
      rememberTools: () => {},
      send: async (message: JSONRPCMessage) => {
        requests.push(message);
        if ('method' in message && 'id' in message) {
          remote.onmessage?.({ jsonrpc: '2.0', id: message.id, result: response });
        }
      },
    } as unknown as WordPressTransport;
    ({ close } = await (
      await import('../../src/lib/pass-through.js')
    ).startPassThrough(local, remote));
  });

  afterEach(async () => {
    unregister.forEach(remove => remove());
    await close();
    delete process.env.WP_API_TIMEOUT_MS;
  });

  function add(hook: Parameters<typeof register>[0]) {
    unregister.push(register(hook));
  }
  async function flush() {
    await new Promise<void>(resolve => setImmediate(resolve));
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  function call(method = 'tools/call') {
    local.onmessage?.({ jsonrpc: '2.0', id: 1, method, params: { name: 'fixture' } });
  }

  it('runs only after a successful tool response, preserving the uninterpreted result', async () => {
    response = { content: 'client validates this', _meta: { extra: true } };
    const names: string[] = [];
    add(({ name }) => {
      names.push(name);
    });
    call();
    expect(names).toEqual([]);
    await flush();
    expect(output).toEqual([{ jsonrpc: '2.0', id: 1, result: response }]);
    expect(names).toEqual(['fixture']);
  });

  it('does not run hooks on other methods or upstream errors', async () => {
    const hook = jest.fn<() => void>();
    add(hook);
    call('tools/list');
    await flush();
    remote.send = async message => {
      if ('id' in message)
        remote.onmessage?.({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32602, message: 'fixture error' },
        });
    };
    call();
    await flush();
    expect(hook).not.toHaveBeenCalled();
  });

  it('isolates synchronous throws and asynchronous rejections', async () => {
    add(() => {
      throw new Error('sync failure');
    });
    add(async () => {
      throw new Error('async failure');
    });
    const hook = jest.fn<() => void>();
    add(hook);
    call();
    await flush();
    expect(hook).toHaveBeenCalledTimes(1);
    expect(output).toHaveLength(1);
  });

  it('stops invoking unregistered hooks', async () => {
    const hook = jest.fn<() => void>();
    const remove = register(hook);
    remove();
    call();
    await flush();
    expect(hook).not.toHaveBeenCalled();
  });

  it('dispatches hook requests on the live transport and keeps their responses off client stdout', async () => {
    let result: object | undefined;
    add(async ({ wpRequest }) => {
      result = await wpRequest({
        method: 'tools/call',
        name: 'telemetry',
        arguments: { event: 'fixture' },
      });
    });
    call();
    await flush();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'telemetry', arguments: { event: 'fixture' } },
    });
    expect(result).toEqual({ content: [] });
    expect(output).toHaveLength(1);
  });

  it('routes a JSON-RPC wpRequest without params over the live transport without leaking envelope fields', async () => {
    const { wpRequest } = await import('../../src/lib/wordpress-api.js');
    await wpRequest({ jsonrpc: '2.0', id: 7, method: 'tools/list' });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: 'tools/list' });
    expect((requests[0] as { params?: unknown }).params).toEqual({});
  });
});
