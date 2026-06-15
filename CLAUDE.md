# mcp-wordpress-remote

MCP proxy server between Claude Code and a WordPress backend.

## Commit discipline

**Every line in a commit must trace to the stated goal.** No drive-by cleanups, no unrelated "improvements." The 0.2.20 race condition was caused by a harmless-looking capabilities change (`tools: {}` → `tools: { listChanged: false }`) bundled with an unrelated SOCKS proxy fix. Review every changed line — if it isn't required for the task, remove it before committing.

## Pre-publish release gate

"Works in repo" is not enough. Gate on "works from packed artifact in clean environment."

1. Verify `MCP_WORDPRESS_REMOTE_VERSION` in `src/lib/config.ts` matches `package.json` — this constant is hardcoded and must be bumped manually alongside the package version.
2. Build and pack: `npm ci && npm run build && npm pack`
3. Install tarball in a clean temp dir, run the binary: `cd $(mktemp -d) && npm init -y && npm install /path/to/tarball && ./node_modules/.bin/mcp-wordpress-remote --help`
4. Test against a healthy WordPress endpoint — send `initialize` + `tools/list` via stdin, confirm `serverInfo.version` matches the new version and tools are returned.
5. Test against a broken endpoint (no auth configured) — confirm fallback `connectionFailed` response, no crash.
6. Debug logs: verify no forwarded requests fire before init settles (stderr should be clean on a healthy run).
7. Know the last good version — be ready for immediate dist-tag rollback if needed.

E2E tests live in `/Users/eoingallagher/Development/wpcom-mcp-bruno-collection/tests/mcp-e2e` — run `npm run test:account` as a quick smoke test against the live WordPress.com MCP endpoint (bearer token already configured in `.env`).

## Publishing a release

Do NOT publish to npm manually. Creating a GitHub release triggers CI to publish automatically.

1. Complete the pre-publish release gate above.
2. Create a GitHub release tagged `vX.Y.Z` targeting `trunk`:
   ```
   gh release create vX.Y.Z --title "vX.Y.Z" --target trunk --notes "..."
   ```
3. Confirm CI published to npm: https://github.com/Automattic/mcp-wordpress-remote/actions

### Downstream repos (update after npm publish confirms)

Both repos pin this package and need PRs + releases after each publish:

**github.com/Automattic/mcp-wpcom-remote**
- Bump `@automattic/mcp-wordpress-remote` in `package.json` + bump the package's own `"version"` to match
- Run `npm install` to update the lockfile
- Open PR, merge, then create a matching GitHub release (`vX.Y.Z`) — this triggers its own npm publish

**github.a8c.com/Automattic/mcp-context-a8c** (internal)
- Bump `@automattic/mcp-wordpress-remote` in `package.json`
- Run `npm install` to update the lockfile
- Open PR, merge, then create a matching GitHub release

## Testing

- Run all tests: `npx jest tests/unit/ --no-coverage`
- Build: `npm run build`
- ESM mocking pattern: set `process.env` vars BEFORE `jest.resetModules()` + dynamic imports (CONFIG caches at import time)
- WordPress API endpoint in nock: `/?rest_route=/wp/v2/wpmcp` (not `/wp/v2/wpmcp`)

## Architecture notes

- Transport detection (JSON-RPC vs simple) runs during the `initialize` handler
- `sessionContext.transportType` starts null — the init-ready gate (`waitForInit`) blocks all handlers until detection settles
- `waitForInit` returns `InitResult` (`{ ready: true } | { ready: false; reason: 'failed' | 'timeout' }`)
