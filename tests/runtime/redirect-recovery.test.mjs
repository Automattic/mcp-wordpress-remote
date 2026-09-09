import assert from 'node:assert/strict';
import test from 'node:test';
import nock from 'nock';

// Run after npm run build. Exercise the real bundled node-fetch redirect path.
test('a proxy refusal after a redirect never replays the original write', async () => {
  process.env.USE_SYSTEM_PROXY = 'true';
  process.env.SOCKS_PROXY = 'socks5h://127.0.0.1:8080';
  process.env.NO_PROXY = 'localhost';
  process.env.WP_API_URL = 'https://redirect.example/mcp';
  process.env.JWT_TOKEN = 'test-only';
  process.env.OAUTH_ENABLED = 'false';
  const { initializeProxy, wpRequest, registerRequestRecoveryHook } = await import(
    '../../dist/lib.js'
  );
  await initializeProxy();
  let hookCalls = 0;
  let writes = 0;
  nock.disableNetConnect();
  const scope = nock('https://redirect.example')
    .post('/mcp')
    .reply(() => {
      writes++;
      return [303, '', { Location: '/result' }];
    })
    .get('/result')
    .replyWithError(Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }));
  const unregister = registerRequestRecoveryHook(() => {
    hookCalls++;
    return true;
  });
  try {
    await assert.rejects(wpRequest({ method: 'tools/call', params: { name: 'write' } }), error => {
      assert.equal(error.code, 'ECONNREFUSED');
      assert.equal(error.viaProxy, true);
      assert.equal(error.redirected, true);
      return true;
    });
    assert.equal(writes, 1);
    assert.equal(hookCalls, 0);
    assert.equal(scope.isDone(), true);
  } finally {
    unregister();
    nock.cleanAll();
    nock.enableNetConnect();
  }
});
