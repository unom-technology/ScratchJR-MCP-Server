// Builds public/app: ScratchJr from ../desktop/src/app, bundled for the browser
// with the web tablet in place of electronClient.js.
//
// The desktop app's source is the only copy of ScratchJr in this repository,
// so a fix there reaches the web version on the next build. public/app is
// generated; copy the whole web_version folder, built, to run it elsewhere.

import { build } from 'esbuild';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appSource = resolve(root, '..', 'desktop', 'src', 'app');
const out = join(root, 'public', 'app');
const require = createRequire(join(root, 'package.json'));

const TITLE = 'ScratchJr';
const PAGES = ['index.html', 'home.html', 'editor.html', 'gettingstarted.html'];
// Everything in desktop/src/app except its code, which is bundled, and its pages, which are rewritten.
const SKIP = new Set(['src', 'appEntry.js', 'settings.json', ...PAGES]);

await rm(out, {recursive: true, force: true});
await mkdir(join(out, 'lib'), {recursive: true});

for (const entry of await readdir(appSource)) {
  if (!SKIP.has(entry)) await cp(join(appSource, entry), join(out, entry), {recursive: true});
}

// Saving every 5 seconds rather than the desktop's 30, so a closed tab loses
// as little as possible. Only a project that changed is saved.
const settings = JSON.parse(await readFile(join(appSource, 'settings.json'), 'utf8'));
Object.assign(settings, {buildName: 'ScratchJr Web', autoSaveInterval: 5000, shareEnabled: false});
await writeFile(join(out, 'settings.json'), JSON.stringify(settings, null, 4) + '\n');

for (const page of PAGES) {
  let html = await readFile(join(appSource, page), 'utf8');
  const client = /<script[^>]*src=['"]\.\.\/electronClient\.js['"][^>]*><\/script>/;
  const entry = /<script[^>]*src=['"]appEntry\.js['"][^>]*><\/script>/;
  if (!client.test(html) || !entry.test(html)) throw new Error(`${page} no longer loads electronClient.js and appEntry.js the way this build expects.`);
  html = html
    .replace(client, '<link rel="stylesheet" href="web.css">\n<script src="lib/sql-wasm.js"></script>')
    .replace(entry, '<script src="web.js"></script>')
    .replace(/<title>[^<]*<\/title>/, `<title>${TITLE}</title>`);
  await writeFile(join(out, page), html);
}

// The desktop app's icon, for the browser tab.
await cp(resolve(appSource, '..', 'icons', 'win', 'icon.ico'), join(out, 'favicon.ico'));

const sqlJs = dirname(require.resolve('sql.js/dist/sql-wasm.js'));
await cp(join(sqlJs, 'sql-wasm.js'), join(out, 'lib', 'sql-wasm.js'));
await cp(join(sqlJs, 'sql-wasm.wasm'), join(out, 'lib', 'sql-wasm.wasm'));

// ScratchJr's own imports (jszip, intl, snapsvg...) resolve from this folder's
// node_modules, so the build does not depend on desktop/ having been installed.
// esbuild's resolver, unlike Node's, picks each package's browser build.
const fromWebVersion = {
  name: 'scratchjr-dependencies',
  setup(context) {
    context.onResolve({filter: /^[^./]/}, args => {
      if (!args.importer.startsWith(appSource)) return undefined;
      return context.resolve(args.path, {kind: args.kind, resolveDir: root});
    });
  },
};

const result = await build({
  entryPoints: [join(root, 'client', 'entry.js')],
  outfile: join(out, 'web.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  // Chrome, Edge and Firefox from 2020 on, Safari 14 on.
  target: 'es2020',
  // ScratchJr's Localization assigns to Node's global object.
  define: {global: 'window'},
  plugins: [fromWebVersion],
  minify: true,
  sourcemap: true,
  legalComments: 'linked',
  logLevel: 'warning',
  // lib.js preprocess() evals ${css_vh(...)} in ScratchJr's CSS; client/entry.js
  // publishes the names it needs, so the renaming this warns about is handled.
  logOverride: {'direct-eval': 'silent'},
  metafile: true,
});

const bytes = Object.values(result.metafile.outputs).reduce((total, output) => total + output.bytes, 0);
console.log(`Built ${out} (${(bytes / 1024 / 1024).toFixed(1)} MB of code)`);
