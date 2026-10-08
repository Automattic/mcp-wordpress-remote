import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Options } from 'tsup';

const NODE_FETCH_SOURCE_SHA256 = 'e0a76062a308610126191bb288925470a2fb84fbbe5c913b444165d64fd9c4b5';

const original = String.raw`\t\tconst onData = buf => {
\t\t\tproperLastChunkReceived = Buffer.compare(buf.slice(-5), LAST_CHUNK) === 0;

\t\t\t// Sometimes final 0-length chunk and end of message code are in separate packets
\t\t\tif (!properLastChunkReceived && previousChunk) {
\t\t\t\tproperLastChunkReceived = (
\t\t\t\t\tBuffer.compare(previousChunk.slice(-3), LAST_CHUNK.slice(0, 3)) === 0 &&
\t\t\t\t\tBuffer.compare(buf.slice(-2), LAST_CHUNK.slice(3)) === 0
\t\t\t\t);
\t\t\t}

\t\t\tpreviousChunk = buf;
\t\t};`.replace(/\\t/g, '\t');

const replacement = `\t\tconst onData = buf => {
\t\t\tif (buf.length === 0) return;
\t\t\t// Retain only the final five bytes, across any number of data events.
\t\t\t// Copy the suffix so a large incoming buffer is not kept alive.
\t\t\tif (buf.length >= LAST_CHUNK.length) {
\t\t\t\ttrailingBytes = Buffer.from(buf.subarray(-LAST_CHUNK.length));
\t\t\t} else {
\t\t\t\ttrailingBytes = Buffer.from(
\t\t\t\t\tBuffer.concat([trailingBytes, buf]).subarray(-LAST_CHUNK.length)
\t\t\t\t);
\t\t\t}
\t\t\tproperLastChunkReceived = trailingBytes.equals(LAST_CHUNK);
\t\t};`;

/**
 * node-fetch 3.3.2 only recognizes the final chunk in one event or a 3+2 split.
 * Apply the bounded rolling-suffix fix while bundling, leaving node_modules
 * untouched. Review this workaround when node-fetch changes; never silently
 * publish its original detector after a dependency update.
 */
export function fixNodeFetchChunkedEnding(source: string): string {
  const hash = createHash('sha256').update(source).digest('hex');
  if (hash !== NODE_FETCH_SOURCE_SHA256) {
    throw new Error('Unexpected node-fetch source; review the chunked-ending build fix');
  }
  const declaration = '\tlet previousChunk;';
  if (source.split(original).length !== 2 || source.split(declaration).length !== 2) {
    throw new Error('Expected exactly one node-fetch chunked-ending detector');
  }
  return source
    .replace(declaration, '\tlet trailingBytes = Buffer.alloc(0);')
    .replace(original, replacement);
}

export function nodeFetchChunkedFix(): NonNullable<Options['esbuildPlugins']>[number] {
  return {
    name: 'node-fetch-chunked-ending',
    setup(build) {
      let applied = false;
      build.onStart(() => {
        applied = false;
      });
      build.onLoad({ filter: /node_modules[\\/]node-fetch[\\/]src[\\/]index\.js$/ }, async args => {
        const contents = fixNodeFetchChunkedEnding(await readFile(args.path, 'utf8'));
        applied = true;
        return { contents, loader: 'js' };
      });
      build.onEnd(() => {
        if (!applied) {
          return { errors: [{ text: 'node-fetch chunked-ending build fix was not applied' }] };
        }
      });
    },
  };
}
