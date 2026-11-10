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
    const bytes = Buffer.from(await response.arrayBuffer());
    const text = bytes.toString('utf8');
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return {status: response.status, json, text, bytes, headers: response.headers, location: response.headers.get('location')};
  };
}

// A student who signed up, logged in: their client and ID.
async function signUp(username, grade = 4, fullName = `${username} Student`) {
  const call = client();
  const made = await call('POST', '/api/register', {fullName, grade, username, password: `${username}-pass`});
  assert.equal(made.status, 201, made.text);
  return {call, id: made.json.id};
}

// An admin, made on the server as `npm run make-admin` does, logged in.
async function signUpAdmin(username) {
  const made = await signUp(username);
  await prisma.user.update({where: {username}, data: {role: 'admin', grade: null}});
  return made;
}

async function login(username, password = `${username}-pass`) {
  const call = client();
  const result = await call('POST', '/api/login', {username, password});
  assert.equal(result.status, 200, result.text);
  return call;
}

const project = (name, extra = {}) => ({
  CTIME: '2026-11-10 08:00:00', MTIME: 1793772021017, NAME: name, JSON: JSON.stringify({pages: ['page 1']}),
  THUMBNAIL: JSON.stringify({pagecount: 1, md5: '1_abc.png'}), DELETED: 'NO', VERSION: 'iOSv01', ISGIFT: 0, ...extra,
});

test('registering checks the name and password, and names are unique regardless of case', async () => {
  const anna = client();
  assert.equal((await anna('POST', '/api/register', {fullName: 'Test Student', grade: 4, username: 'a', password: 'secret1'})).status, 400);
  assert.equal((await anna('POST', '/api/register', {fullName: 'Test Student', grade: 4, username: 'anna', password: '12'})).status, 400);
  assert.equal((await anna('POST', '/api/register', {fullName: 'Test Student', grade: 4, username: '../anna', password: 'secret1'})).status, 400);
  const made = await anna('POST', '/api/register', {fullName: 'Test Student', grade: 4, username: 'Anna', password: 'secret1'});
  assert.equal(made.status, 201);
  assert.equal(made.json.username, 'anna');
  assert.equal((await anna('GET', '/api/me')).json.username, 'anna');
  assert.equal((await client()('POST', '/api/register', {fullName: 'Test Student', grade: 4, username: 'ANNA', password: 'other12'})).status, 409);
});

test('logging in needs the right password, and repeated wrong guesses are slowed down', async () => {
  const ben = client();
  await ben('POST', '/api/register', {fullName: 'Test Student', grade: 4, username: 'ben', password: 'right-one'});
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
  await cara('POST', '/api/register', {fullName: 'Test Student', grade: 4, username: 'cara', password: 'cara-pass'});
  await dan('POST', '/api/register', {fullName: 'Test Student', grade: 4, username: 'dan', password: 'dan-pass'});

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
  await eve('POST', '/api/register', {fullName: 'Test Student', grade: 4, username: 'eve', password: 'eve-pass'});
  const first = (await eve('GET', '/api/state')).json.idBlockStart;
  const second = (await eve('GET', '/api/state')).json.idBlockStart;
  assert.equal(second - first, ID_BLOCK);
  await eve('POST', '/api/sync', {rows: [{table: 'PROJECTS', id: second + ID_BLOCK + 5000, row: project('far')}]});
  const third = (await eve('GET', '/api/state')).json.idBlockStart;
  assert.ok(third > second + ID_BLOCK + 5000);
});

test('anything that is not one of ScratchJr\'s tables, columns or file names is refused', async () => {
  const fay = client();
  await fay('POST', '/api/register', {fullName: 'Test Student', grade: 4, username: 'fay', password: 'fay-pass'});
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
  await gus('POST', '/api/register', {fullName: 'Test Student', grade: 4, username: 'gus', password: 'gus-pass'});
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

test('signing up asks for a full name and a grade, and always makes a student with no section', async () => {
  const lia = client();
  const base = {fullName: 'Lia Cruz', grade: 3, username: 'lia', password: 'lia-pass'};
  assert.equal((await lia('POST', '/api/register', {...base, fullName: '   '})).status, 400);
  for (const grade of [0, 13, 'x', 2.5, null]) assert.equal((await lia('POST', '/api/register', {...base, grade})).status, 400, String(grade));
  const made = await lia('POST', '/api/register', {...base, fullName: '  Lia   Cruz ', grade: '3', role: 'admin', sectionId: 1, section: 'Trust'});
  assert.equal(made.status, 201, made.text);
  assert.deepEqual({...made.json, id: 0}, {id: 0, username: 'lia', fullName: 'Lia Cruz', role: 'student', grade: 3, section: null});
  assert.equal((await lia('GET', '/api/me')).json.role, 'student');
});

test('only teachers and admins reach the admin page and its API', async () => {
  const {call: ivy} = await signUp('ivy');
  assert.equal((await ivy('GET', '/api/admin/students')).status, 403);
  assert.equal((await ivy('GET', '/api/admin/accounts')).status, 403);
  assert.equal((await ivy('GET', '/admin')).location, '/app/home.html');
  assert.equal((await ivy('GET', '/')).location, '/app/home.html');
  const nobody = client();
  assert.equal((await nobody('GET', '/api/admin/students')).status, 401);
  assert.equal((await nobody('GET', '/admin')).location, '/login');
  // Nothing a student's browser sends can change a role.
  assert.equal((await ivy('POST', '/api/sync', {rows: [{table: 'User', id: 1, row: {role: 'admin'}}]})).status, 400);
  assert.equal((await ivy('POST', '/api/admin/accounts', {username: 'ivy-admin', fullName: 'X', password: 'pass1', role: 'admin'})).status, 403);
  assert.equal((await ivy('GET', '/api/me')).json.role, 'student');
});

test('an admin manages sections and every kind of account', async () => {
  const {call: boss, id: bossId} = await signUpAdmin('boss');
  assert.equal((await boss('GET', '/')).location, '/admin');
  assert.equal((await boss('GET', '/admin')).status, 200);

  // Sections: unique within a grade, and only a name can change.
  const add = body => boss('POST', '/api/admin/sections', body);
  const trust = (await add({grade: 4, name: ' Trust '})).json.section;
  assert.deepEqual({...trust, id: 0}, {id: 0, grade: 4, name: 'Trust'});
  const faith = (await add({grade: 3, name: 'Faithfulness'})).json.section;
  const hope = (await add({grade: 4, name: 'Hope'})).json.section;
  assert.equal((await add({grade: 3, name: 'Trust'})).status, 201);
  assert.equal((await add({grade: 4, name: 'Trust'})).status, 409);
  assert.equal((await add({grade: 13, name: 'Late'})).status, 400);
  assert.equal((await add({grade: 4, name: ''})).status, 400);
  assert.equal((await boss('PATCH', `/api/admin/sections/${hope.id}`, {name: 'Trust'})).status, 409);
  assert.equal((await boss('PATCH', `/api/admin/sections/${hope.id}`, {name: 'Hopeful'})).json.section.name, 'Hopeful');

  // A teacher, made by the admin, with the sections they teach.
  const made = await boss('POST', '/api/admin/accounts', {
    role: 'teacher', fullName: 'Rafael Bendigo', username: 'Rafael', password: 'rafael-pass', teachingIds: [trust.id, faith.id], grade: 9, sectionId: hope.id,
  });
  assert.equal(made.status, 201, made.text);
  assert.equal(made.json.account.role, 'teacher');
  assert.equal(made.json.account.grade, null);
  assert.equal(made.json.account.section, null);
  assert.deepEqual(made.json.account.teaching.map(s => s.id), [faith.id, trust.id]);
  const rafael = await login('rafael');
  assert.equal((await rafael('GET', '/api/me')).json.role, 'teacher');
  assert.equal((await rafael('GET', '/')).location, '/admin');

  // Students: a section must be in the student's grade.
  const student = body => boss('POST', '/api/admin/accounts', {role: 'student', fullName: 'Mia Lopez', username: 'mia', password: 'mia-pass', ...body});
  assert.equal((await student({grade: 3, sectionId: trust.id})).status, 400);
  assert.equal((await student({sectionId: trust.id})).status, 400);
  const mia = (await student({grade: 4, sectionId: trust.id})).json.account;
  assert.deepEqual(mia.section, trust);
  assert.equal((await student({grade: 4})).status, 409);
  assert.equal((await boss('POST', '/api/admin/accounts', {role: 'owner', fullName: 'X', username: 'x1', password: 'pass1'})).status, 400);
  assert.equal((await boss('POST', '/api/admin/accounts', {role: 'teacher', fullName: 'X', username: 'x2', password: 'pass1', teachingIds: [999999]})).status, 400);

  // A student who signed up has no section until the admin gives one.
  const {call: sam, id: samId} = await signUp('sam', 4, 'Sam Reyes');
  const placed = await boss('PATCH', `/api/admin/accounts/${samId}`, {sectionId: hope.id});
  assert.equal(placed.status, 200, placed.text);
  assert.equal(placed.json.account.section.name, 'Hopeful');
  assert.equal((await sam('GET', '/api/me')).json.section.name, 'Hopeful');
  // Changing grade without a matching section is refused; with one, it moves.
  assert.equal((await boss('PATCH', `/api/admin/accounts/${samId}`, {grade: 3})).status, 400);
  assert.equal((await boss('PATCH', `/api/admin/accounts/${samId}`, {grade: 3, sectionId: faith.id})).json.account.section.id, faith.id);

  // A new password logs them out; the new one works.
  assert.equal((await boss('PATCH', `/api/admin/accounts/${samId}`, {password: 'new-pass'})).status, 200);
  assert.equal((await sam('GET', '/api/me')).status, 401);
  await login('sam', 'new-pass');
  // An empty password leaves it as it was.
  assert.equal((await boss('PATCH', `/api/admin/accounts/${samId}`, {password: '', fullName: 'Samuel Reyes'})).json.account.fullName, 'Samuel Reyes');
  await login('sam', 'new-pass');

  // Changing role: a student made a teacher leaves their grade and section.
  const promoted = (await boss('PATCH', `/api/admin/accounts/${samId}`, {role: 'teacher', teachingIds: [hope.id]})).json.account;
  assert.deepEqual([promoted.role, promoted.grade, promoted.section, promoted.teaching.map(s => s.id)], ['teacher', null, null, [hope.id]]);
  const demoted = (await boss('PATCH', `/api/admin/accounts/${samId}`, {role: 'student', grade: 4})).json.account;
  assert.deepEqual([demoted.role, demoted.grade, demoted.teaching], ['student', 4, []]);
  assert.equal((await boss('PATCH', `/api/admin/accounts/${samId}`, {username: 'rafael'})).status, 409);

  // Admins can't lock themselves out.
  assert.equal((await boss('PATCH', `/api/admin/accounts/${bossId}`, {role: 'teacher'})).status, 400);
  assert.equal((await boss('DELETE', `/api/admin/accounts/${bossId}`)).status, 400);
  const renamedSelf = await boss('PATCH', `/api/admin/accounts/${bossId}`, {fullName: 'Ms. Santos', password: 'boss-new'});
  assert.equal(renamedSelf.json.account.fullName, 'Ms. Santos');
  assert.equal((await boss('GET', '/api/me')).status, 200, 'their own browser stays logged in');

  // Deleting an account deletes its work.
  const samAgain = await login('sam', 'new-pass');
  const samProject = (await samAgain('GET', '/api/state')).json.idBlockStart;
  await samAgain('POST', '/api/sync', {rows: [{table: 'PROJECTS', id: samProject, row: project('Sam\'s')}]});
  assert.equal(await prisma.project.count({where: {userId: samId}}), 1);
  assert.equal((await boss('DELETE', `/api/admin/accounts/${samId}`)).status, 200);
  assert.equal(await prisma.project.count({where: {userId: samId}}), 0);
  assert.equal((await samAgain('GET', '/api/me')).status, 401);
  assert.equal((await boss('DELETE', `/api/admin/accounts/${samId}`)).status, 404);

  // Deleting a section leaves its students without one, and its teachers without it.
  assert.equal((await boss('DELETE', `/api/admin/sections/${trust.id}`)).status, 200);
  assert.equal((await prisma.user.findUnique({where: {username: 'mia'}})).sectionId, null);
  const rafaelNow = (await boss('GET', '/api/admin/accounts')).json.accounts.find(a => a.username === 'rafael');
  assert.deepEqual(rafaelNow.teaching.map(s => s.id), [faith.id]);

  // Teachers can't manage anything.
  for (const [method, path] of [['GET', '/api/admin/accounts'], ['POST', '/api/admin/accounts'], ['PATCH', `/api/admin/accounts/${mia.id}`],
    ['DELETE', `/api/admin/accounts/${mia.id}`], ['POST', '/api/admin/sections'], ['PATCH', `/api/admin/sections/${faith.id}`], ['DELETE', `/api/admin/sections/${faith.id}`]]) {
    assert.equal((await rafael(method, path, method === 'GET' || method === 'DELETE' ? undefined : {name: 'X', role: 'admin'})).status, 403, `${method} ${path}`);
  }
});

test('a teacher sees only the students in the sections they teach', async () => {
  const {call: admin} = await signUpAdmin('principal');
  const section = async (grade, name) => (await admin('POST', '/api/admin/sections', {grade, name})).json.section;
  const g4trust = await section(4, 'Kindness');
  const g3faith = await section(3, 'Patience');
  const g4other = await section(4, 'Honesty');
  await admin('POST', '/api/admin/accounts', {role: 'teacher', fullName: 'Rafael Bendigo', username: 'rbendigo', password: 'rbendigo-pass', teachingIds: [g4trust.id, g3faith.id]});
  const teacher = await login('rbendigo');

  const place = async (username, grade, sectionId) => {
    const {call, id} = await signUp(username, grade);
    if (sectionId) await admin('PATCH', `/api/admin/accounts/${id}`, {sectionId});
    return {call, id};
  };
  const ken = await place('ken', 4, g4trust.id);
  const noel = await place('noel', 3, g3faith.id);
  const ana = await place('ana', 4, g4other.id);
  const zed = await place('zed', 4, null);
  const kenProject = (await ken.call('GET', '/api/state')).json.idBlockStart;
  await ken.call('POST', '/api/sync', {files: [{name: 'ken.svg', contents: 'PHN2Zz4='}], rows: [{table: 'PROJECTS', id: kenProject, row: project('Ken\'s town')}]});
  const anaProject = (await ana.call('GET', '/api/state')).json.idBlockStart;
  await ana.call('POST', '/api/sync', {files: [{name: 'ana.svg', contents: 'PHN2Zz4='}], rows: [{table: 'PROJECTS', id: anaProject, row: project('Ana\'s')}]});

  // Their own two sections, and the students in them.
  const sections = (await teacher('GET', '/api/admin/sections')).json.sections;
  assert.deepEqual(sections.map(s => `${s.grade} ${s.name}`), ['3 Patience', '4 Kindness']);
  const seen = (await teacher('GET', '/api/admin/students')).json.students;
  assert.deepEqual(seen.map(s => s.username).sort(), ['ken', 'noel']);
  assert.equal(seen.find(s => s.username === 'ken').section.name, 'Kindness');
  assert.equal(seen.find(s => s.username === 'ken').projectCount, 1);

  // Ken's work opens; Ana's (another section) and Zed's (no section) do not.
  assert.equal((await teacher('GET', `/api/admin/students/${ken.id}`)).json.projects[0].name, 'Ken\'s town');
  assert.equal((await teacher('GET', `/api/admin/students/${ken.id}/state`)).json.projects.length, 1);
  assert.equal((await teacher('GET', `/api/admin/students/${ken.id}/files/ken.svg`)).text, 'PHN2Zz4=');
  for (const other of [ana.id, zed.id]) {
    for (const path of ['', '/state', '/files/ana.svg']) {
      assert.equal((await teacher('GET', `/api/admin/students/${other}${path}`)).status, 404, `${other}${path}`);
    }
  }

  // The admin sees all of them, including the student with no section.
  const all = (await admin('GET', '/api/admin/students')).json.students.map(s => s.username);
  for (const name of ['ken', 'noel', 'ana', 'zed']) assert.ok(all.includes(name), name);

  // Taking a section away takes its students away at once.
  const rafaelId = (await teacher('GET', '/api/me')).json.id;
  await admin('PATCH', `/api/admin/accounts/${rafaelId}`, {teachingIds: [g3faith.id]});
  assert.deepEqual((await teacher('GET', '/api/admin/students')).json.students.map(s => s.username), ['noel']);
  assert.equal((await teacher('GET', `/api/admin/students/${ken.id}/state`)).status, 404);
});

test('an admin sees every student\'s projects and opens them without changing anything', async () => {
  const {call: kim, id: kimId} = await signUp('kim', 4, 'Kim Santos');
  const id = (await kim('GET', '/api/state')).json.idBlockStart;
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  await kim('POST', '/api/sync', {
    files: [
      {name: 'kim-cat.svg', contents: 'PHN2Zz4='},
      {name: `${id}_thumb.png`, contents: png.toString('base64')},
      {name: 'evil.svg', contents: 'PHN2Zz4='},
    ],
    rows: [
      {table: 'PROJECTS', id, row: project('Kim\'s park', {MTIME: '1794269795337', THUMBNAIL: JSON.stringify({pagecount: 4, md5: `${id}_thumb.png`})})},
      {table: 'PROJECTS', id: id + 1, row: project('Thrown away', {DELETED: 'YES'})},
      {table: 'PROJECTS', id: id + 2, row: project('From a file', {ISGIFT: 1, THUMBNAIL: JSON.stringify({pagecount: 1, md5: 'evil.svg'})})},
    ],
  });

  const {call: admin, id: adminId} = await signUpAdmin('headteacher');

  // The list counts projects that are not deleted, and leaves out teachers and admins.
  const list = (await admin('GET', '/api/admin/students')).json.students;
  const kimRow = list.find(s => s.username === 'kim');
  assert.equal(kimRow.id, kimId);
  assert.equal(kimRow.fullName, 'Kim Santos');
  assert.equal(kimRow.projectCount, 2);
  assert.ok(kimRow.lastChangeAt);
  assert.ok(!list.some(s => s.username === 'headteacher' || s.username === 'rafael'));
  assert.equal(list.find(s => s.username === 'ivy').projectCount, 0);

  const detail = (await admin('GET', `/api/admin/students/${kimId}`)).json;
  assert.equal(detail.student.username, 'kim');
  assert.deepEqual(detail.projects.map(p => p.name), ['Kim\'s park', 'From a file']);
  assert.deepEqual(detail.projects[0], {id, name: 'Kim\'s park', changedAt: new Date(1794269795337).toISOString(), thumbnail: `${id}_thumb.png`, pages: 4, isGift: false});
  assert.equal(detail.projects[1].isGift, true);

  // What ScratchJr opens: all of Kim's rows, and her files, without using up
  // any of her project numbers.
  const cursorBefore = (await prisma.user.findUnique({where: {id: kimId}})).idCursor;
  const view = (await admin('GET', `/api/admin/students/${kimId}/state`)).json;
  assert.deepEqual(view.student, {id: kimId, username: 'kim', fullName: 'Kim Santos'});
  assert.equal(view.projects.length, 3);
  assert.ok(view.idBlockStart > id + 2);
  assert.equal((await prisma.user.findUnique({where: {id: kimId}})).idCursor, cursorBefore);
  assert.equal((await admin('GET', `/api/admin/students/${kimId}/files/kim-cat.svg`)).text, 'PHN2Zz4=');
  assert.equal((await admin('GET', `/api/admin/students/${kimId}/files/nope.svg`)).status, 404);

  // Thumbnails come back as PNG images, and nothing else is served that way.
  const thumb = await admin('GET', `/api/admin/students/${kimId}/thumbnails/${id}_thumb.png`);
  assert.equal(thumb.status, 200);
  assert.equal(thumb.headers.get('content-type'), 'image/png');
  assert.deepEqual(thumb.bytes, png);
  assert.equal((await admin('GET', `/api/admin/students/${kimId}/thumbnails/evil.svg`)).status, 404);

  // Only students can be looked at.
  for (const bad of [adminId, 999999, 'abc', 0, '99999999999']) {
    assert.equal((await admin('GET', `/api/admin/students/${bad}`)).status, 404, String(bad));
  }

  // The admin's own projects are still their own, and Kim's are unchanged.
  assert.deepEqual((await admin('GET', '/api/state')).json.projects, []);
  assert.equal((await kim('GET', '/api/state')).json.projects.length, 3);
});

test('logging out ends the session, and writes from another site are refused', async () => {
  const hal = client();
  await hal('POST', '/api/register', {fullName: 'Test Student', grade: 4, username: 'hal', password: 'hal-pass'});
  assert.equal((await hal('POST', '/api/sync', {rows: []}, {Origin: 'http://evil.example'})).status, 403);
  assert.equal((await hal('POST', '/api/sync', {rows: []}, {Origin: base})).status, 200);
  assert.equal((await hal('POST', '/api/logout')).status, 200);
  assert.equal((await hal('GET', '/api/me')).status, 401);
  assert.equal((await hal('GET', '/')).location, '/login');
});
