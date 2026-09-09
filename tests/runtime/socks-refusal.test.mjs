import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import test from 'node:test';

// Run after npm run build. Uses the real bundled node-fetch and SOCKS stack.
test('closed SOCKS listener retains ECONNREFUSED through wpRequest', async () => {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((resolve, reject) =>
    listener.close(error => (error ? reject(error) : resolve()))
  );

  process.env.USE_SYSTEM_PROXY = 'true';
  process.env.SOCKS_PROXY = `socks5h://127.0.0.1:${port}`;
  process.env.NO_PROXY = 'localhost';
  process.env.WP_API_URL = 'https://example.invalid/mcp';
  process.env.JWT_TOKEN = 'test-only';
  process.env.OAUTH_ENABLED = 'false';
  const { initializeProxy, wpRequest, registerRequestRecoveryHook } = await import(
    '../../dist/lib.js'
  );
  await initializeProxy();
  let observed;
  const unregister = registerRequestRecoveryHook(context => {
    observed = context.error;
    return false;
  });
  try {
    await assert.rejects(wpRequest({ method: 'tools/list' }), error => {
      assert.equal(error.code, 'ECONNREFUSED');
      assert.equal(error.viaProxy, true);
      assert.equal(error, observed);
      return true;
    });
  } finally {
    unregister();
  }
});
