// One-time setup on the server PC, safe to run again: makes .env from
// .env.example if there is none, then creates or updates the database.

import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Prisma's CLI script, run with this Node rather than through npx and a shell.
const prismaCli = createRequire(join(root, 'package.json')).resolve('prisma/build/index.js');

if (!existsSync(join(root, '.env'))) {
  await copyFile(join(root, '.env.example'), join(root, '.env'));
  console.log('Created .env with the default settings.');
}
await mkdir(join(root, 'data'), {recursive: true});

function prisma(...args) {
  const result = spawnSync(process.execPath, [prismaCli, ...args], {cwd: root, stdio: 'inherit'});
  if (result.status !== 0) throw new Error(`prisma ${args.join(' ')} failed with exit code ${result.status}.`);
}

prisma('generate');
// Applies the migrations in prisma/migrations; existing students and projects are kept.
prisma('migrate', 'deploy');

console.log('Database ready. Next: npm run build (once), then npm start.');
