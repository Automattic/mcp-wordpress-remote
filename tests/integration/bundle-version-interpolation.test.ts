/**
 * Smoke test against the built tsup bundle.
 *
 * Source-level unit tests cannot catch this class of bug: ESM semantics in
 * source preserve TDZ and live bindings, so a module-top-level
 * `const VERSION = MCP_WORDPRESS_REMOTE_VERSION;` works fine under ts-jest.
 * Once tsup flattens multiple ESM modules into a single file and emits
 * top-level `const` as `var`, the guarantee is lost: if the capturing module
 * is ordered before the defining module, `VERSION` resolves to `undefined`
 * and the config directory becomes `wordpress-remote-undefined/`.
 *
 * This test asserts the bundle does not contain the broken capture pattern
 * and does interpolate the version identifier directly inside the template.
 * Requires `npm run build` to have produced `dist/proxy.js`.
 */

import fs from 'fs';
import path from 'path';

const bundlePath = path.resolve(__dirname, '../../dist/proxy.js');
const bundleExists = fs.existsSync(bundlePath);

if (!bundleExists) {
  // eslint-disable-next-line no-console
  console.warn(
    `[bundle-version-interpolation] Skipping: ${bundlePath} not found. Run \`npm run build\` first.`
  );
}

const describeIfBuilt = bundleExists ? describe : describe.skip;

describeIfBuilt('built bundle: version interpolation in getConfigDir', () => {
  let bundleSource: string;

  beforeAll(() => {
    bundleSource = fs.readFileSync(bundlePath, 'utf-8');
  });

  it('does not capture MCP_WORDPRESS_REMOTE_VERSION at module top level', () => {
    // The pre-fix pattern. tsup emitted `var VERSION = MCP_WORDPRESS_REMOTE_VERSION`
    // at line 35881 while `var MCP_WORDPRESS_REMOTE_VERSION = "x.y.z"` landed later
    // at line 36142. Hoisting made the capture resolve to `undefined`.
    expect(bundleSource).not.toMatch(/var\s+VERSION\s*=\s*MCP_WORDPRESS_REMOTE_VERSION/);
  });

  it('interpolates MCP_WORDPRESS_REMOTE_VERSION directly into the config dir template', () => {
    expect(bundleSource).toMatch(/wordpress-remote-\$\{MCP_WORDPRESS_REMOTE_VERSION\}/);
  });
});
