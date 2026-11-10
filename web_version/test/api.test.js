// The server's API against a throwaway database.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createApp } from '../server/app.js';
import { ID_BLOCK } from '../server/store.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'sjr-web-test-'));
const url = 'file:' + join(dir, 'test.db').replace(/\\/g, '/');

let prisma;
let server;
let base;

before(async () => {
  const prismaCli = join(root, 'node_modules', 'prisma', 'build', 'index.js');
  const migrate = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: root, env: {...process.env, DATABASE_URL: url}, encoding: 'utf8',
  });
  assert.equal(migrate.status, 0, migrate.stderr || migrate.stdout);
  const { PrismaClient } = await import(pathToFileURL(join(root, 'node_modules', '@prisma', 'client', 'index.js')).href);
  prisma = new PrismaClient({datasources: {db: {url}}});
  const app = createApp({prisma, config: {sessionHours: 1, appDir: join(dir, 'no-app'), staticDir: join(root, 'static')}});
  await new Promise(done => { server = app.listen(0, '127.0.0.1', done); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.close();
  await prisma?.$disconnect();
  rmSync(dir, {recursive: true, force: true});
});

// A tiny browser: keeps the session cookie between calls.
function client() {
  let cookie = '';
  return async function call(method, path, body, headers = {}) {
    const response = await fetch(base + path, {
      method,
      headers: {...(body !== undefined ? {'Content-Type': 'application/json'} : {}), ...(cookie ? {Cookie: cookie} : {}), ...headers},
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    const set = response.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return {status: response.status, json, text, location: response.headers.get('location')};
  };
}

const project = (name, extra = {}) => ({
  CTIME: '2026-11-10 08:00:00', MTIME: 1793772021017, NAME: name, JSON: JSON.stringify({pages: ['page 1']}),
  THUMBNAIL: JSON.stringify({pagecount: 1, md5: '1_abc.png'}), DELETED: 'NO', VERSION: 'iOSv01', ISGIFT: 0, ...extra,
});

test('registering checks the name and password, and names are unique regardless of case', async () => {
  const anna = client();
  assert.equal((await anna('POST', '/api/register', {username: 'a', password: 'secret1'})).status, 400);
  assert.equal((await anna('POST', '/api/register', {username: 'anna', password: '12'})).status, 400);
  assert.equal((await anna('POST', '/api/register', {username: '../anna', password: 'secret1'})).status, 400);
  const made = await anna('POST', '/api/register', {username: 'Anna', password: 'secret1'});
  assert.equal(made.status, 201);
  assert.equal(made.json.username, 'anna');
  assert.equal((await anna('GET', '/api/me')).json.username, 'anna');
  assert.equal((await client()('POST', '/api/register', {username: 'ANNA', password: 'other12'})).status, 409);
});

test('logging in needs the right password, and repeated wrong guesses are slowed down', async () => {
  const ben = client();
  await ben('POST', '/api/register', {username: 'ben', password: 'right-one'});
  const guesser = client();
  assert.equal((await guesser('POST', '/api/login', {username: 'ben', password: 'wrong'})).status, 401);
  assert.equal((await guesser('POST', '/api/login', {username: 'nobody', password: 'wrong'})).status, 401);
  assert.equal((await guesser('GET', '/api/me')).status, 401);
  const ok = await guesser('POST', '/api/login', {username: 'BEN', password: 'right-one'});
  assert.equal(ok.status, 200);
  assert.equal((await guesser('GET', '/api/me')).json.username, 'ben');

  const attacker = client();
  for (let i = 0; i < 8; i++) await attacker('POST', '/api/login', {username: 'ben', password: 'guess' + i});
  assert.equal((await attacker('POST', '/api/login', {username: 'ben', password: 'right-one'})).status, 429);
});

test('a student\'s projects, characters and files are theirs alone', async () => {
  const cara = client();
  const dan = client();
  await cara('POST', '/api/register', {username: 'cara', password: 'cara-pass'});
  await dan('POST', '/api/register', {username: 'dan', password: 'dan-pass'});

  const cs = (await cara('GET', '/api/state')).json;
  assert.deepEqual(cs.projects, []);
  const id = cs.idBlockStart;
  const synced = await cara('POST', '/api/sync', {
    files: [{name: 'abc123.svg', contents: 'PHN2Zz4='}],
    rows: [
      {table: 'PROJECTS', id, row: project('Cara\'s story')},
      {table: 'USERSHAPES', id, row: {MD5: 'abc123.svg', WIDTH: 120, HEIGHT: '80', EXT: 'svg', NAME: 'Star', SCALE: '0.5', VERSION: 'iOSv01'}},
    ],
  });
  assert.equal(synced.status, 200, synced.text);

  const again = (await cara('GET', '/api/state')).json;
  assert.equal(again.projects.length, 1);
  assert.equal(again.projects[0].ID, id);
  assert.equal(again.projects[0].NAME, 'Cara\'s story');
  assert.equal(again.projects[0].MTIME, '1793772021017');
  assert.equal(again.shapes[0].WIDTH, '120');
  assert.equal((await cara('GET', '/api/files/abc123.svg')).text, 'PHN2Zz4=');

  // Dan sees none of it, and cannot reach it by name or ID.
  const ds = (await dan('GET', '/api/state')).json;
  assert.deepEqual([ds.projects, ds.shapes], [[], []]);
  assert.equal((await dan('GET', '/api/files/abc123.svg')).status, 404);
  await dan('POST', '/api/sync', {rows: [{table: 'PROJECTS', id, row: project('Dan\'s')}]});
  assert.equal((await cara('GET', '/api/state')).json.projects[0].NAME, 'Cara\'s story');
  assert.equal((await dan('GET', '/api/state')).json.projects[0].NAME, 'Dan\'s');

  // A deletion removes the row.
  await cara('POST', '/api/sync', {rows: [{table: 'PROJECTS', id, row: null}]});
  assert.equal((await cara('GET', '/api/state')).json.projects.length, 0);
});

test('each page load gets its own block of IDs, above every ID already used', async () => {
  const eve = client();
  await eve('POST', '/api/register', {username: 'eve', password: 'eve-pass'});
  const first = (await eve('GET', '/api/state')).json.idBlockStart;
  const second = (await eve('GET', '/api/state')).json.idBlockStart;
  assert.equal(second - first, ID_BLOCK);
  await eve('POST', '/api/sync', {rows: [{table: 'PROJECTS', id: second + ID_BLOCK + 5000, row: project('far')}]});
  const third = (await eve('GET', '/api/state')).json.idBlockStart;
  assert.ok(third > second + ID_BLOCK + 5000);
});

test('anything that is not one of ScratchJr\'s tables, columns or file names is refused', async () => {
  const fay = client();
  await fay('POST', '/api/register', {username: 'fay', password: 'fay-pass'});
  const refused = async body => assert.equal((await fay('POST', '/api/sync', body)).status, 400, JSON.stringify(body));
  await refused({rows: [{table: 'User', id: 1, row: {username: 'x'}}]});
  await refused({rows: [{table: 'PROJECTS', id: 1, row: {PASSWORDHASH: 'x'}}]});
  await refused({rows: [{table: 'PROJECTS', id: 0, row: project('zero')}]});
  await refused({rows: [{table: 'PROJECTS', id: 1, row: project('bad', {ISGIFT: 'yes'})}]});
  await refused({files: [{name: '../../server/app.js', contents: 'x'}]});
  await refused({files: [{name: 'a/b.svg', contents: 'x'}]});
  // Nothing from a refused batch is applied.
  await refused({files: [{name: 'ok.svg', contents: 'x'}], rows: [{table: 'NOPE', id: 1, row: {}}]});
  assert.equal((await fay('GET', '/api/files/ok.svg')).status, 404);
  assert.equal((await client()('POST', '/api/sync', {rows: []})).status, 401);
});

test('cleaning removes only files nothing refers to', async () => {
  const gus = client();
  await gus('POST', '/api/register', {username: 'gus', password: 'gus-pass'});
  const id = (await gus('GET', '/api/state')).json.idBlockStart;
  await gus('POST', '/api/sync', {
    files: ['used-in-project.svg', 'used-by-shape.svg', 'orphan.svg', 'thumb.png'].map(name => ({name, contents: 'x'})),
    rows: [
      {table: 'PROJECTS', id, row: project('p', {JSON: JSON.stringify({pages: ['page 1'], 'page 1': {md5: 'used-in-project.svg'}})})},
      {table: 'USERSHAPES', id, row: {MD5: 'used-by-shape.svg', EXT: 'svg'}},
    ],
  });
  assert.deepEqual((await gus('POST', '/api/files/clean', {type: 'svg'})).json, {removed: 1});
  assert.equal((await gus('GET', '/api/files/orphan.svg')).status, 404);
  for (const kept of ['used-in-project.svg', 'used-by-shape.svg', 'thumb.png']) assert.equal((await gus('GET', `/api/files/${kept}`)).status, 200, kept);
});

test('logging out ends the session, and writes from another site are refused', async () => {
  const hal = client();
  await hal('POST', '/api/register', {username: 'hal', password: 'hal-pass'});
  assert.equal((await hal('POST', '/api/sync', {rows: []}, {Origin: 'http://evil.example'})).status, 403);
  assert.equal((await hal('POST', '/api/sync', {rows: []}, {Origin: base})).status, 200);
  assert.equal((await hal('POST', '/api/logout')).status, 200);
  assert.equal((await hal('GET', '/api/me')).status, 401);
  assert.equal((await hal('GET', '/')).location, '/login');
});
