# mcp-wordpress-remote

MCP proxy server between Codex and a WordPress backend.

## Commit discipline

**Every line in a commit must trace to the stated goal.** No drive-by cleanups, no unrelated "improvements." The 0.2.20 race condition was caused by a harmless-looking capabilities change (`tools: {}` → `tools: { listChanged: false }`) bundled with an unrelated SOCKS proxy fix. Review every changed line — if it isn't required for the task, remove it before committing.

## Pre-publish release gate

"Works in repo" is not enough. Gate on "works from packed artifact in clean environment."

1. Build and pack: `npm ci && npm run build && npm pack`
2. Install tarball in a clean temp dir, run `npx mcp-wordpress-remote --help`
3. Test against a healthy WordPress endpoint (normal init + tools/list flow)
4. Test against a broken endpoint (fallback init, no malformed forwarding)
5. Debug logs: verify no forwarded requests fire before init settles
6. Publish canary first (`x.y.z-canary.1`), soak in real clients, then promote to latest
7. Know the last good version — be ready for immediate dist-tag rollback

## Testing

- Run all tests: `npx jest tests/unit/ --no-coverage`
- Build: `npm run build`
- ESM mocking pattern: set `process.env` vars BEFORE `jest.resetModules()` + dynamic imports (CONFIG caches at import time)
- WordPress API endpoint in nock: `/?rest_route=/wp/v2/wpmcp` (not `/wp/v2/wpmcp`)

## Architecture notes

- Transport detection (JSON-RPC vs simple) runs during the `initialize` handler
- `sessionContext.transportType` starts null — the init-ready gate (`waitForInit`) blocks all handlers until detection settles
- `waitForInit` returns `InitResult` (`{ ready: true } | { ready: false; reason: 'failed' | 'timeout' }`)
