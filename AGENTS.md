# mcp-wordpress-remote

MCP proxy server between an MCP client and a WordPress backend.

## Commits

- Before committing, run `npm run check` and `npx jest tests/unit/ tests/integration/ --no-coverage`. CI runs the same steps on every PR (`.github/workflows/ci.yml`), so this only saves you the round trip — there is no pre-commit hook.
- Keep every line in a commit traceable to its stated goal. A one-token capabilities change (`tools: {}` → `tools: { listChanged: false }`) once rode along with an unrelated fix and caused a transport race.

## Pre-publish release gate

"Works in repo" is not enough. Gate on "works from packed artifact in clean environment."

1. Build and pack: `npm ci && npm run build && npm pack`
2. Install the tarball in a clean temp dir. Confirm `dist/proxy.js` is the tsup bundle (~2.4 MB single file), not per-file output — the binary has no `--help`, so it cannot be smoke-tested by invoking it bare
3. Test against a healthy WordPress endpoint (normal init + tools/list flow)
4. Test against a broken endpoint (fallback init, no malformed forwarding)
5. Debug logs: verify no forwarded requests fire before init settles

## Version

The version lives in two places that must move together: `version` in `package.json` and `MCP_WORDPRESS_REMOTE_VERSION` in `src/lib/config.ts`. Letting them drift once shipped a token directory literally named `wordpress-remote-undefined`. The token store is namespaced by version, so any bump forces every user to re-authenticate.

## Testing

- Run all tests: `npx jest tests/unit/ tests/integration/ --no-coverage` (`tests/unit/` alone skips the integration suites)
- Build: `npm run build`
- ESM mocking pattern: set `process.env` vars BEFORE `jest.resetModules()` + dynamic imports (CONFIG caches at import time)
- WordPress API endpoint in nock: `/?rest_route=/wp/v2/wpmcp` (not `/wp/v2/wpmcp`)

## Architecture notes

- Transport detection (JSON-RPC vs simple) runs during the `initialize` handler
- `sessionContext.transportType` starts null — the init-ready gate (`waitForInit`) blocks all handlers until detection settles
- `waitForInit` returns `InitResult` (`{ ready: true } | { ready: false; reason: 'failed' | 'timeout' }`)
