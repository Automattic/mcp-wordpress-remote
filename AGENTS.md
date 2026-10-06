# mcp-wordpress-remote

MCP proxy server between an MCP client and a WordPress backend.

## Commits

- Before committing, run `npm run check` and `npx jest tests/unit/ tests/integration/ --no-coverage`. CI runs the same steps on every PR (`.github/workflows/ci.yml`), so this only saves you the round trip — there is no pre-commit hook.
- Keep every line in a commit traceable to its stated goal. A one-token capabilities change (`tools: {}` → `tools: { listChanged: false }`) once rode along with an unrelated fix and caused a transport race.

## Pre-publish release gate

"Works in repo" is not enough. Gate on "works from packed artifact in clean environment."

1. Build and pack: `npm ci && npm run build && npm pack`
2. Install the tarball in a clean temp dir. Confirm `dist/proxy.js` is a single tsup bundle, not per-file output — the binary has no `--help`, so it cannot be smoke-tested by invoking it bare
3. Test against a healthy WordPress endpoint (normal init + tools/list flow)
4. Test against a broken endpoint (fallback init, no malformed forwarding)
5. Debug logs: verify no forwarded requests fire before init settles

## Version

The version lives in two places that must move together: `version` in `package.json` and `MCP_WORDPRESS_REMOTE_VERSION` in `src/lib/config.ts`. Letting them drift once shipped a token directory literally named `wordpress-remote-undefined`. The token store is namespaced by version, so any bump forces every user to re-authenticate.

## Testing

- Run all tests: `npx jest tests/unit/ tests/integration/ --no-coverage` (`tests/unit/` alone skips the integration suites)
- Build: `npm run build`
- ESM mocking pattern: set `process.env` vars BEFORE `jest.resetModules()` + dynamic imports (CONFIG caches at import time)
- WordPress API endpoint in nock: `/?rest_route=/mcp/mcp-adapter-default-server`; full configured endpoint paths are used directly

## Architecture notes

- The CLI connects SDK transports directly; client initialization is forwarded without a separate SDK Client or Server handshake.
- Forward complete JSON-RPC messages. Keep protocol-version and method selection with the endpoints; the proxy observes the initialize response to populate HTTP headers.
- An in-flight initialize gates subsequent client methods until its response or failure. Preserve degraded connection handling and never retry through the archived simple-format transport.
- Keep WordPress authentication/configuration in the shared HTTP header helper. System-proxy responses use Node streams and require Web stream adaptation for SDK SSE parsing.
- Verify CLI behavior through `tests/integration/pass-through.test.ts`. It can also target a clean installed artifact with `PROXY_TEST_PATH=/absolute/path/to/dist/proxy.js`.
