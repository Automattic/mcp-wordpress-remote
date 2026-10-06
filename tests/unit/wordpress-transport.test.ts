import { jest } from '@jest/globals';

describe('WordPress transport authentication deadline', () => {
  it('starts the request deadline after authentication, so a slow login does not time out', async () => {
    const previous = process.env.WP_API_INIT_TIMEOUT_MS;
    process.env.WP_API_INIT_TIMEOUT_MS = '20';
    jest.resetModules();
    const api = await import('../../src/lib/wordpress-api.js');
    const fetch = await import('../../src/lib/fetch-utils.js');
    const headers = jest.spyOn(api, 'getWordPressHeaders').mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
      return { Authorization: 'Bearer fixture-token' };
    });
    const network = jest
      .spyOn(fetch, 'proxyFetch')
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({ jsonrpc: '2.0', id: 0, result: { protocolVersion: '2025-11-25' } }),
            { headers: { 'Content-Type': 'application/json' } }
          ) as any
      );
    const failures: any[] = [];
    const transport = (
      await import('../../src/lib/wordpress-transport.js')
    ).createWordPressTransport((_message, error) => failures.push(error));
    const received: unknown[] = [];
    transport.onmessage = message => received.push(message);
    transport.onerror = () => {};
    try {
      await transport.start();
      await transport.send({
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25' },
      });
      expect(network).toHaveBeenCalledTimes(1);
      expect(failures).toEqual([]);
      expect(received).toEqual([
        { jsonrpc: '2.0', id: 0, result: { protocolVersion: '2025-11-25' } },
      ]);
    } finally {
      await transport.close();
      headers.mockRestore();
      network.mockRestore();
      if (previous === undefined) delete process.env.WP_API_INIT_TIMEOUT_MS;
      else process.env.WP_API_INIT_TIMEOUT_MS = previous;
    }
  });
});
