import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const outdir = path.join(root, 'dist');
await mkdir(outdir, { recursive: true });
await cp(path.join(root, 'public'), outdir, { recursive: true });
for (const name of ['background', 'content', 'popup', 'options']) {
  await build({ entryPoints: [path.join(root, `src/${name}.ts`)], bundle: true,
    outfile: path.join(outdir, `${name}.js`), format: name === 'content' ? 'iife' : 'esm',
    platform: 'browser', target: 'chrome120', sourcemap: false, legalComments: 'eof' });
}
const licenses = path.join(outdir, 'licenses');
await mkdir(licenses, { recursive: true });
for (const file of ['LICENSE', 'LICENSE-MIT']) {
  await cp(path.join(root, 'node_modules/@anthropic-ai/sdk', file), path.join(licenses, `anthropic-sdk-${file}.txt`));
}
await cp(path.join(root, 'node_modules/@anthropic-ai/sdk/src/internal/qs/LICENSE.md'), path.join(licenses, 'qs-LICENSE.txt'));
console.log('Extension built in dist/');
