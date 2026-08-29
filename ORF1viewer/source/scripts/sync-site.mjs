import { cp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const sourceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(sourceDir, 'dist');
const siteDir = path.resolve(sourceDir, '..');
const preservedEntries = new Set(['README.md', 'source']);

let buildEntries;
try {
  buildEntries = await readdir(buildDir, { withFileTypes: true });
} catch (error) {
  if (error && typeof error === 'object' && error.code === 'ENOENT') {
    throw new Error('Build output is missing. Run `npm run build` before syncing the site.');
  }
  throw error;
}

for (const entry of await readdir(siteDir, { withFileTypes: true })) {
  if (!preservedEntries.has(entry.name)) {
    await rm(path.join(siteDir, entry.name), { recursive: true, force: true });
  }
}

for (const entry of buildEntries) {
  if (entry.name === 'data') continue;
  await cp(path.join(buildDir, entry.name), path.join(siteDir, entry.name), {
    recursive: true,
    force: true,
  });
}

const indexPath = path.join(siteDir, 'index.html');
await writeFile(indexPath, (await readFile(indexPath, 'utf8')).replace(/\r\n/g, '\n'));
await writeFile(path.join(siteDir, '.nojekyll'), '');
