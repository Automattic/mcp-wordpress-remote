import { Agent } from 'node:http';
import { SocksProxyAgent } from 'socks-proxy-agent';

describe('proxy fetch attribution', () => {
  let fetchWithProxyAgent: typeof import('../../src/lib/fetch-utils.js').fetchWithProxyAgent;
  let isProxyFetchError: typeof import('../../src/lib/fetch-utils.js').isProxyFetchError;

  beforeAll(async () => {
    ({ fetchWithProxyAgent, isProxyFetchError } = await import('../../src/lib/fetch-utils.js'));
  });

  it('marks a network failure when a proxy agent was selected', async () => {
    const cause = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
    const nodeFetch = () => Promise.reject(cause);
    const error = await fetchWithProxyAgent(
      nodeFetch,
      'https://example.com',
      undefined,
      new Agent()
    ).catch(value => value);

    expect(isProxyFetchError(error)).toBe(true);
    expect(error.cause).toBe(cause);
  });

  it('does not mark an ordinary network failure', () => {
    const cause = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });

    expect(isProxyFetchError(cause)).toBe(false);
  });

  it('marks a refusal after a redirect as potentially already executed', async () => {
    const cause = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
    const agent = new Agent();
    const nodeFetch = async (_url: string, init: any) => {
      expect(init.agent(new URL('http://redirect.example/write'))).toBe(agent);
      expect(init.agent(new URL('http://redirect.example/result'))).toBe(agent);
      throw cause;
    };
    const error = await fetchWithProxyAgent(
      nodeFetch,
      'http://redirect.example/write',
      { method: 'POST', body: 'payload' },
      agent
    ).catch(value => value);

    expect(isProxyFetchError(error)).toBe(true);
    expect(error.redirected).toBe(true);
    expect(error.cause.code).toBe('ECONNREFUSED');
  });

  it.each([
    ['connect ECONNREFUSED 127.0.0.1:8080', 'system', undefined, 'ECONNREFUSED'],
    ['connect ECONNREFUSED 127.0.0.1:8081', 'system', undefined, undefined],
    ['connect ETIMEDOUT 127.0.0.1:8080', 'system', undefined, undefined],
    ['connect ECONNREFUSED 127.0.0.1:8080', 'aborted', undefined, undefined],
    ['connect ECONNREFUSED 127.0.0.1:8080', 'system', 'ETIMEDOUT', undefined],
    ['SOCKS handshake failed', 'system', undefined, undefined],
  ])(
    'normalizes only a matching SOCKS refusal (%s, %s, %s)',
    async (reason, type, code, expected) => {
      const cause = Object.assign(
        new Error(`request to https://example.com/ failed, reason: ${reason}`),
        {
          name: 'FetchError2',
          type,
          code,
        }
      );
      const error = await fetchWithProxyAgent(
        () => Promise.reject(cause),
        'https://example.com',
        undefined,
        new SocksProxyAgent('socks5h://127.0.0.1:8080')
      ).catch(value => value);
      expect(error.code).toBe(expected);
      expect(error.cause).toBe(cause);
    }
  );
});
