import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { context } from 'esbuild';
import { fixNodeFetchChunkedEnding, nodeFetchChunkedFix } from '../../build/node-fetch-chunked-fix';

describe('node-fetch chunked-ending build fix', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../node_modules/node-fetch/src/index.js'),
    'utf8'
  );

  it('transforms the reviewed source without writing the installed dependency', () => {
    const patched = fixNodeFetchChunkedEnding(source);
    expect(patched).toContain('let trailingBytes = Buffer.alloc(0);');
    expect(patched).toContain('trailingBytes.equals(LAST_CHUNK)');
    expect(patched).not.toContain('previousChunk');
    expect(
      fs.readFileSync(path.resolve(__dirname, '../../node_modules/node-fetch/src/index.js'), 'utf8')
    ).toBe(source);
  });

  it('rejects changed source rather than silently skipping the fix', () => {
    expect(() => fixNodeFetchChunkedEnding(source + '\n')).toThrow('Unexpected node-fetch source');
  });

  it('requires the fix on every rebuild, including after a successful build', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'node-fetch-build-fix-'));
    const entry = path.join(directory, 'entry.js');
    fs.writeFileSync(
      entry,
      `import fetch from ${JSON.stringify(require.resolve('node-fetch'))}; export default fetch;`
    );
    const build = await context({
      entryPoints: [entry],
      bundle: true,
      platform: 'node',
      write: false,
      logLevel: 'silent',
      plugins: [nodeFetchChunkedFix()],
    });
    try {
      await build.rebuild();
      // An unchanged rebuild must still carry the fix.
      await build.rebuild();
      fs.writeFileSync(entry, 'export default true;');
      await expect(build.rebuild()).rejects.toThrow(
        'node-fetch chunked-ending build fix was not applied'
      );
    } finally {
      await build.dispose();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
