import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';
import { nodeFetchChunkedFix } from './build/node-fetch-chunked-fix';

// Preserve the existing package build settings and patch node-fetch only in
// esbuild's input, so both published bundles contain the corrected detector.
const { tsup } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({ ...tsup, esbuildPlugins: [nodeFetchChunkedFix()] });
