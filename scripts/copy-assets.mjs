// Copy non-TS runtime assets (the official IRS 1040 template) into dist so the
// compiled server can read them at the same relative path it uses in source.
// tsc only emits .js; this fills the gap.
import { mkdir, copyFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcAssets = join(root, 'src', 'assets');
const distAssets = join(root, 'dist', 'assets');

await mkdir(distAssets, { recursive: true });
for (const name of await readdir(srcAssets)) {
  await copyFile(join(srcAssets, name), join(distAssets, name));
  console.log(`copied asset: ${name}`);
}
