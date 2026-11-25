import { jest } from '@jest/globals';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { WordPressTransport } from '../../src/lib/wordpress-transport.js';

describe('reconnecting after a deferred approval', () => {
  it('holds requests delivered together until the new initialize settles', async () => {
    jest.resetModules();
    const { startPassThrough } = await import('../../src/lib/pass-through.js');
    const { ApprovalRequired } = await import('../../src/lib/deferred-approval.js');
    const flush = () => new Promise(resolve => setImmediate(resolve));
    const sent: any[] = [];
    const output: any[] = [];
    let approved = false;
    const remote = {
      start: async () => {},
      close: async () => {},
      setProtocolVersion: () => {},
      cancelRequest: () => {},
      rememberTools: () => {},
      send: async (message: any) => {
        sent.push(message);
        if (message.method === 'initialize' && !approved)
          throw new ApprovalRequired('https://approval.example/connect/1');
      },
    } as unknown as WordPressTransport;
    const local = {
      start: async () => {},
      close: async () => {},
      send: async (message: any) => {
        output.push(message);
      },
    } as Transport;
    const { close } = await startPassThrough(local, remote);
    const receive = (message: object) => local.onmessage!({ jsonrpc: '2.0', ...message } as any);
    const methods = () => sent.map(message => message.method);
    const replies = (id: number) => output.filter(message => message.id === id);
    try {
      receive({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
      await flush();
      expect(replies(1)[0].result.instructions).toContain('https://approval.example/connect/1');

      // Still unapproved: one shared attempt, and every tool request gets the link.
      sent.length = 0;
      receive({ id: 2, method: 'tools/list' });
      receive({ id: 3, method: 'tools/call', params: { name: 'fixture' } });
      await flush();
      expect(methods()).toEqual(['initialize']);
      expect(replies(2)[0].result.tools[0].name).toBe('oauth_approval');
      expect(replies(3)[0].result.isError).toBe(true);

      approved = true;
      sent.length = 0;
      receive({ id: 4, method: 'tools/list' });
      receive({ id: 5, method: 'resources/list' });
      receive({ id: 6, method: 'tools/call', params: { name: 'oauth_approval' } });
      await flush();
      expect(methods()).toEqual(['initialize']);

      remote.onmessage!({
        jsonrpc: '2.0',
        id: sent[0].id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          serverInfo: { name: 'fixture', version: '1' },
        },
      });
      await flush();
      expect(methods().slice(0, 2)).toEqual(['initialize', 'notifications/initialized']);
      expect(methods().slice(2).sort()).toEqual(['resources/list', 'tools/list']);
      expect(replies(6)[0].result.content[0].text).toContain('Connected');
    } finally {
      await close();
    }
  });
});
