// The browser's stand-in for the tablet: what desktop/src/electronClient.js is
// to the desktop app, and the native code is to ScratchJr on an iPad.
//
// ScratchJr talks to its host through window.tablet, synchronously, and keeps
// its projects in SQL tables. Each page here therefore builds those tables in
// an in-memory SQLite (sql.js) from the student's data on the server, and runs
// ScratchJr's SQL against them unchanged. Triggers note every row a statement
// touches, and those rows go straight back to the server, which keeps them per
// student with Prisma. The server never runs SQL from a browser.

import SparkMD5 from 'spark-md5';
import iOS from '../../desktop/src/app/src/iPad/iOS.js';
import Camera from '../../desktop/src/app/src/painteditor/Camera.js';
import { AudioCapture, CameraPickerDialog, mediaAvailable, tryPlay } from './media.js';

// The same tables the desktop app creates (desktop/src/main.js initTables),
// with the ISGIFT column its migration adds.
const SCHEMA = {
  PROJECTS: 'CREATE TABLE PROJECTS (ID INTEGER PRIMARY KEY AUTOINCREMENT, CTIME DATETIME DEFAULT CURRENT_TIMESTAMP, MTIME DATETIME, ALTMD5 TEXT, POS INTEGER, NAME TEXT, JSON TEXT, THUMBNAIL TEXT, OWNER TEXT, GALLERY TEXT, DELETED TEXT, VERSION TEXT, ISGIFT INTEGER DEFAULT 0)',
  USERSHAPES: 'CREATE TABLE USERSHAPES (ID INTEGER PRIMARY KEY AUTOINCREMENT, CTIME DATETIME DEFAULT CURRENT_TIMESTAMP, MD5 TEXT, ALTMD5 TEXT, WIDTH TEXT, HEIGHT TEXT, EXT TEXT, NAME TEXT, OWNER TEXT, SCALE TEXT, VERSION TEXT)',
  USERBKGS: 'CREATE TABLE USERBKGS (ID INTEGER PRIMARY KEY AUTOINCREMENT, CTIME DATETIME DEFAULT CURRENT_TIMESTAMP, MD5 TEXT, ALTMD5 TEXT, WIDTH TEXT, HEIGHT TEXT, EXT TEXT, OWNER TEXT, VERSION TEXT)',
};

const RETRY_MS = 5000;

// An admin looking at a student's work in this tab: the student's ID. The admin
// page passes it as ?student= on the first page; it is kept for the tab because
// ScratchJr builds its own page addresses (editor.html?pmd5=..., home.html?place=...)
// and drops anything else in them.
const VIEWING_KEY = 'sjr-web-viewing';

function viewingStudentId() {
  const fromPage = new URLSearchParams(window.location.search).get('student');
  let id = fromPage;
  try {
    if (fromPage) window.sessionStorage.setItem(VIEWING_KEY, fromPage);
    else id = window.sessionStorage.getItem(VIEWING_KEY);
  } catch (error) { /* storage blocked: only this page shows the student */ }
  return /^\d{1,10}$/.test(id || '') ? id : null;
}

function forgetViewing() {
  try { window.sessionStorage.removeItem(VIEWING_KEY); } catch (error) { /* storage blocked */ }
}

export function stopViewing() {
  forgetViewing();
  window.location.href = '/admin';
}

// ---------------------------------------------------------------- server calls

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ScratchJr expects its answers at once, so most calls here are synchronous
// XHR. On a classroom network that is a few milliseconds.
function request(method, url, body) {
  const xhr = new XMLHttpRequest();
  xhr.open(method, url, false);
  if (body !== undefined) xhr.setRequestHeader('Content-Type', 'application/json');
  try {
    xhr.send(body === undefined ? null : JSON.stringify(body));
  } catch (error) {
    throw new HttpError(0, 'The ScratchJr server could not be reached.');
  }
  return xhr;
}

function requestJson(method, url, body) {
  const xhr = request(method, url, body);
  if (xhr.status < 200 || xhr.status >= 300) throw new HttpError(xhr.status, errorText(xhr.responseText) || `Server answered ${xhr.status}`);
  return xhr.responseText ? JSON.parse(xhr.responseText) : null;
}

function errorText(text) {
  try { return JSON.parse(text).error; } catch (error) { return null; }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {credentials: 'same-origin', ...options});
  if (!response.ok) throw new HttpError(response.status, errorText(await response.text()) || `Server answered ${response.status}`);
  return response.json();
}

export function goToLogin(reason) {
  window.location.href = '/login' + (reason ? '?reason=' + encodeURIComponent(reason) : '');
}

function emit(name, detail) {
  window.dispatchEvent(new CustomEvent(name, {detail}));
}

// ---------------------------------------------------------------- saving

// Changes on their way to the server, newest last. A row or file that changes
// twice before it is sent goes once, with its latest contents. If the server
// cannot be reached, the queue is kept in localStorage for this student, sent
// again every few seconds, and sent first thing on the next page they open.
class SaveQueue {
  constructor(userId) {
    this.storageKey = 'sjr-web-unsaved-' + userId;
    this.entries = new Map();
    this.timer = null;
    this.state = 'saved';
    try {
      const stored = JSON.parse(window.localStorage.getItem(this.storageKey) || '[]');
      for (const entry of stored) this.entries.set(entry.key, entry);
    } catch (error) { /* nothing kept, or storage blocked */ }
  }

  get size() {
    return this.entries.size;
  }

  addRow(table, id, row) {
    this.put({key: `row:${table}:${id}`, row: {table, id, row}});
  }

  addFile(name, contents) {
    this.put({key: `file:${name}`, file: {name, contents}});
  }

  put(entry) {
    // Delete first, so a changed entry moves to the end and keeps the order.
    this.entries.delete(entry.key);
    this.entries.set(entry.key, entry);
  }

  body() {
    const entries = [...this.entries.values()];
    return {
      files: entries.filter(e => e.file).map(e => e.file),
      rows: entries.filter(e => e.row).map(e => e.row),
    };
  }

  // Sends everything now, while the page waits. Returns whether the server has
  // it all. Once a save has failed, or one is already on its way, this only
  // queues: a synchronous request to a server that is down can hang the page
  // for many seconds, and could also land after a newer one.
  flush() {
    if (!this.entries.size) return true;
    if (this.inFlight || this.state === 'offline') {
      this.store();
      this.schedule();
      return false;
    }
    const sending = new Map(this.entries);
    this.setState('saving');
    try {
      requestJson('POST', '/api/sync', this.body());
    } catch (error) {
      return this.failed(error, sending);
    }
    this.sent(sending);
    return true;
  }

  // The same without holding up the page, and with a time limit; used for retries.
  async flushInBackground() {
    if (!this.entries.size || this.inFlight) return this.entries.size === 0;
    const sending = new Map(this.entries);
    this.inFlight = true;
    this.setState('saving');
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 15000);
    try {
      await fetchJson('/api/sync', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(this.body()), signal: abort.signal});
    } catch (error) {
      return this.failed(error.status !== undefined ? error : new HttpError(0, 'The ScratchJr server could not be reached.'), sending);
    } finally {
      clearTimeout(timeout);
      this.inFlight = false;
    }
    this.sent(sending);
    return true;
  }

  // Drops what the server now has. Anything changed again in the meantime
  // stays queued, and goes straight away.
  sent(sending) {
    for (const [key, entry] of sending) {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    }
    this.store();
    if (this.entries.size) {
      this.state = 'saving';
      this.schedule(0);
    } else {
      this.setState('saved');
    }
  }

  failed(error, sending) {
    if (error.status === 401) {
      // The login ran out. What is queued is kept for after logging in again.
      this.store();
      this.setState('offline', 'Your login has ended. Log in again to keep saving.');
      goToLogin('expired');
      return false;
    }
    if (error.status === 400 || error.status === 413) {
      // The server will never take these, so retrying would only repeat the error.
      console.warn('The server refused a change', error);
      for (const [key, entry] of sending) {
        if (this.entries.get(key) === entry) this.entries.delete(key);
      }
      this.store();
      this.setState('rejected', error.message);
      if (this.entries.size) this.schedule(0);
      else this.setState('saved');
      return false;
    }
    console.warn('Saving to the server failed', error);
    this.store();
    this.setState('offline', error.message);
    this.schedule();
    return false;
  }

  schedule(delay = RETRY_MS) {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flushInBackground();
    }, delay);
  }

  store() {
    try {
      if (this.entries.size) window.localStorage.setItem(this.storageKey, JSON.stringify([...this.entries.values()]));
      else window.localStorage.removeItem(this.storageKey);
      this.storeFailed = false;
    } catch (error) {
      // Over the browser's storage limit, which a long recording can be:
      // the queue then lives only in this page until it is sent.
      console.warn('Could not keep unsaved changes in the browser', error);
      this.storeFailed = true;
    }
  }

  setState(state, message) {
    this.state = state;
    emit('sjr-save-state', {state, message, pending: this.entries.size});
  }
}

// The save queue while an admin looks at a student's work: changes stay in the
// page and go with it. Nothing may be sent: /api/sync would take it as the
// admin's own work, and replace the admin's project that has the same number.
class DiscardQueue {
  constructor() {
    this.entries = new Map();
    this.storeFailed = false;
  }

  get size() {
    return 0;
  }

  addRow() {}

  addFile() {}

  flush() {
    return true;
  }

  async flushInBackground() {
    return true;
  }

  schedule() {}
}

// ---------------------------------------------------------------- the tablet

class WebTablet {
  // viewing is the student an admin is looking at, or null for one's own work.
  constructor({SQL, user, state, viewing}) {
    this.user = user;
    this.viewing = viewing;
    this.filesUrl = viewing ? `/api/admin/students/${viewing.id}/files/` : '/api/files/';
    this.queue = viewing ? new DiscardQueue() : new SaveQueue(user.id);
    this.media = new Map(); // file name -> contents, for this page
    this.mediaChunks = {}; // ScratchJr reads big files in pieces
    this.currentAudio = {};
    this.soundSources = {};
    this.projectFileHandlers = null;
    this.db = this.buildDatabase(SQL, state);

    // Changes a previous page could not send are part of what this page shows.
    for (const entry of this.queue.entries.values()) {
      if (entry.file && entry.file.contents !== null) this.media.set(entry.file.name, entry.file.contents);
    }
    if (this.queue.size) this.queue.schedule(0);

    // Only when the browser could not hold the queue is closing the page a risk.
    window.addEventListener('beforeunload', event => {
      if (this.queue.size && this.queue.storeFailed) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
  }

  buildDatabase(SQL, state) {
    const db = new SQL.Database();
    const rows = {PROJECTS: state.projects, USERSHAPES: state.shapes, USERBKGS: state.backgrounds};
    const write = (table, row) => {
      const columns = Object.keys(row);
      db.run(`INSERT OR REPLACE INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`, columns.map(c => row[c]));
    };
    db.exec('BEGIN');
    for (const create of Object.values(SCHEMA)) db.exec(create);
    for (const table of Object.keys(SCHEMA)) {
      for (const row of rows[table]) write(table, row);
    }
    for (const entry of this.queue.entries.values()) {
      if (!entry.row || !SCHEMA[entry.row.table]) continue;
      if (entry.row.row) write(entry.row.table, entry.row.row);
      else db.run(`DELETE FROM ${entry.row.table} WHERE ID = ?`, [entry.row.id]);
    }
    // New rows are numbered from this page's own block (see server/store.js).
    for (const table of Object.keys(SCHEMA)) {
      db.run('DELETE FROM sqlite_sequence WHERE name = ?', [table]);
      db.run('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)', [table, state.idBlockStart - 1]);
    }
    // Added after the rows above, so loading them is not mistaken for a change.
    db.exec('CREATE TABLE _changes (tbl TEXT NOT NULL, rid INTEGER NOT NULL, PRIMARY KEY (tbl, rid))');
    for (const table of Object.keys(SCHEMA)) {
      for (const [event, ref] of [['INSERT', 'NEW'], ['UPDATE', 'NEW'], ['DELETE', 'OLD']]) {
        db.exec(`CREATE TRIGGER _${table}_${event} AFTER ${event} ON ${table} BEGIN INSERT OR IGNORE INTO _changes VALUES ('${table}', ${ref}.ID); END`);
      }
    }
    db.exec('COMMIT');
    return db;
  }

  // Queues the rows the last statement touched and sends them.
  saveChanges() {
    const changed = this.db.exec('SELECT tbl, rid FROM _changes');
    if (!changed.length) return;
    this.db.run('DELETE FROM _changes');
    for (const [table, id] of changed[0].values) {
      const statement = this.db.prepare(`SELECT * FROM ${table} WHERE ID = ?`);
      statement.bind([id]);
      this.queue.addRow(table, id, statement.step() ? statement.getAsObject() : null);
      statement.free();
    }
    this.queue.flush();
  }

  // Database

  database_stmt(json) {
    let lastRowId = -1;
    try {
      const {stmt, values} = JSON.parse(json);
      this.db.run(stmt, bindable(values));
      lastRowId = this.db.exec('SELECT last_insert_rowid()')[0].values[0][0];
    } catch (error) {
      console.warn('database_stmt failed', json, error);
      return -1;
    }
    this.saveChanges();
    return lastRowId;
  }

  database_query(json) {
    try {
      const {stmt, values} = JSON.parse(json);
      const statement = this.db.prepare(stmt);
      statement.bind(bindable(values));
      const rows = [];
      while (statement.step()) rows.push(statement.getAsObject());
      statement.free();
      return JSON.stringify(rows);
    } catch (error) {
      console.warn('database_query failed', json, error);
      return '[]';
    }
  }

  // Files: characters, backgrounds, thumbnails and recordings

  io_getmedia(name) {
    if (this.media.has(name)) return this.media.get(name);
    let contents = null;
    try {
      const xhr = request('GET', this.filesUrl + encodeURIComponent(name));
      if (xhr.status === 200) contents = xhr.responseText;
      else if (xhr.status === 401) goToLogin('expired');
    } catch (error) {
      console.warn('Could not fetch', name, error);
      return null;
    }
    if (contents !== null) this.media.set(name, contents);
    return contents;
  }

  io_getmedialen(name, key) {
    const contents = this.io_getmedia(name);
    this.mediaChunks[key] = contents || '';
    return this.mediaChunks[key].length;
  }

  io_getmediadata(key, offset, length) {
    const contents = this.mediaChunks[key];
    return contents === undefined ? null : contents.substring(offset, offset + length);
  }

  io_getmediadone(key) {
    delete this.mediaChunks[key];
    return true;
  }

  // As on the desktop, a file's name is the MD5 of its base64 contents.
  io_setmedia(contents, ext) {
    return this.io_setmedianame(contents, SparkMD5.hash(contents), ext);
  }

  io_setmedianame(contents, key, ext) {
    const name = `${key}.${ext}`;
    if (this.media.get(name) === contents) return name;
    this.media.set(name, contents);
    this.queue.addFile(name, contents);
    this.queue.flush();
    return name;
  }

  io_getmd5(contents) {
    return contents ? SparkMD5.hash(contents) : null;
  }

  io_remove(name) {
    this.media.delete(name);
    this.queue.addFile(name, null);
    this.queue.flush();
    return true;
  }

  // Tidies files nothing uses any more. Skipped while anything is still
  // waiting to be saved: the server would judge "unused" against rows it has
  // not received yet, and could remove a file a new character needs. Never
  // while viewing a student: it would tidy the admin's own files instead.
  io_cleanassets(fileType) {
    if (this.viewing || this.queue.size) return true;
    try { requestJson('POST', '/api/files/clean', {type: fileType}); } catch (error) { console.warn('Cleaning files failed', error); }
    return true;
  }

  // Only ever homescroll.sjr, the lobby's scroll position; kept for this tab.
  io_getfile(name) {
    try { return window.sessionStorage.getItem(this.fileKey(name)); } catch (error) { return null; }
  }

  io_setfile(name, base64) {
    try { window.sessionStorage.setItem(this.fileKey(name), base64); } catch (error) { /* storage blocked */ }
    return name;
  }

  fileKey(name) {
    return `sjr-web-file-${this.viewing ? 'student' + this.viewing.id : this.user.id}-${name}`;
  }

  // A file shipped with the app: settings, the media library, help pages.
  io_gettextresource(filename) {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', filename, false);
    try { xhr.send(null); } catch (error) { return null; }
    return xhr.status === 200 ? xhr.responseText : null;
  }

  // The second field is not '0', which tells ScratchJr to fetch files through
  // io_getmedia rather than from a path; the last two say whether recording
  // and the camera can be offered.
  io_getsettings() {
    const available = mediaAvailable();
    return `web,false,${available.microphone ? 'YES' : 'NO'},${available.camera ? 'YES' : 'NO'}`;
  }

  // Sounds

  // As the desktop's io_getAudioData: the app's own files first, then the
  // student's recordings. A bare name such as tap.wav is in sounds/, so that is
  // tried first rather than asking for a file that is never there.
  soundSource(name) {
    if (name in this.soundSources) return this.soundSources[name];
    let source = null;
    for (const candidate of name.includes('/') ? [name, 'sounds/' + name] : ['sounds/' + name, name]) {
      if (/^[\w./-]+$/.test(candidate) && !candidate.includes('..')) {
        const xhr = new XMLHttpRequest();
        xhr.open('HEAD', candidate, false);
        try { xhr.send(null); } catch (error) { continue; }
        if (xhr.status === 200) {
          source = candidate;
          break;
        }
      }
    }
    if (!source) {
      const stored = this.io_getmedia(name);
      if (stored) source = stored.startsWith('data:') ? stored : `data:audio/${name.split('.').pop()};base64,${stored}`;
    }
    this.soundSources[name] = source;
    return source;
  }

  io_registersound(dir, name) {
    if (!this.currentAudio[name]) this.loadSound(name, this.soundSource(name));
  }

  loadSound(name, source) {
    if (!source || !name) return;
    const audio = new window.Audio(source);
    audio.volume = 0.8; // don't oversaturate the speakers
    // ScratchJr waits for this before running the next block.
    audio.onended = () => iOS.soundDone(name);
    this.currentAudio[name] = audio;
  }

  io_playsound(name) {
    const audio = this.currentAudio[name];
    if (!audio) {
      // An unknown sound still has to finish, or the script would stall.
      setTimeout(() => iOS.soundDone(name), 1);
      return;
    }
    tryPlay(audio);
  }

  io_stopsound(name) {
    if (this.currentAudio[name]) this.currentAudio[name].pause();
  }

  audioCapture() {
    if (!this.capture) this.capture = new AudioCapture();
    return this.capture;
  }

  recordsound_recordstart() {
    this.stopping = null;
    return this.audioCapture().startRecord();
  }

  recordsound_recordstop() {
    this.stopping = this.audioCapture().stopRecord();
  }

  recordsound_volume() {
    return this.audioCapture().getVolume();
  }

  // keep is 'YES' when the tick is pressed. The last chunk of a recording only
  // arrives after the recorder stops, hence waiting on stopping.
  recordsound_recordclose(keep) {
    const capture = this.audioCapture();
    const stopped = this.stopping || capture.stopRecord();
    if (keep !== 'YES') return;
    const id = capture.getId();
    stopped.then(() => {
      const blob = capture.captureRecordingAsBlob();
      if (!blob) return;
      const reader = new FileReader();
      reader.onload = () => {
        // Kept as a data URL, the same as the desktop app keeps a recording.
        this.io_setmedianame(reader.result, id, 'webm');
        this.loadSound(id + '.webm', reader.result);
      };
      reader.readAsDataURL(blob);
    });
  }

  recordsound_startplay() {
    this.audioCapture().startPlay();
  }

  recordsound_stopplay() {
    this.audioCapture().stopPlay();
  }

  // Camera

  scratchjr_cameracheck() {
    return mediaAvailable().camera;
  }

  scratchjr_startfeed(json) {
    if (!this.cameraPicker) {
      this.cameraPicker = new CameraPickerDialog(JSON.parse(json));
      this.cameraPicker.show();
    }
  }

  scratchjr_stopfeed() {
    if (this.cameraPicker) {
      this.cameraPicker.hide();
      this.cameraPicker = null;
    }
  }

  scratchjr_choosecamera() {}

  scratchjr_captureimage() {
    const image = this.cameraPicker && this.cameraPicker.snapshot();
    if (image) Camera.processimage(image.split(',')[1]);
  }

  // Everything else ScratchJr asks a tablet

  askForPermission() {
    return true;
  }

  hideSplash() {
    return true;
  }

  // Shown as the author in a project's info box.
  deviceName() {
    const person = this.viewing || this.user;
    return person.fullName || person.username;
  }

  analyticsEvent() {}

  // Export to Computer: on a tablet this opens the share sheet; here the packed
  // project downloads as an .sjr file.
  sendSjrUsingShareDialog(fileName, emailSubject, emailBody, shareType, b64data) {
    const bytes = Uint8Array.from(atob(b64data), c => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], {type: 'application/octet-stream'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = (fileName || 'Project') + '.sjr';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    emit('sjr-project-file', {action: 'save', fileName: link.download});
  }

  setProjectFileHandlers(handlers) {
    this.projectFileHandlers = handlers;
  }

  projectFileResult(result) {
    emit('sjr-project-file', result);
  }
}

// sql.js refuses undefined; SQLite's NULL is what ScratchJr means by it.
function bindable(values) {
  return Array.isArray(values) ? values.map(v => (v === undefined ? null : v)) : [];
}

// ---------------------------------------------------------------- start up

function showStartupError(message, retry) {
  const box = document.createElement('div');
  box.className = 'sjr-web-startup-error';
  box.innerHTML = '<h1>ScratchJr can\'t start</h1><p></p><button type="button">Try again</button>';
  box.querySelector('p').textContent = message;
  box.querySelector('button').onclick = retry;
  document.body.appendChild(box);
}

export async function startTablet() {
  let me;
  try {
    me = await fetchJson('/api/me');
  } catch (error) {
    if (error.status === 401) return goToLogin();
    return showStartupError('The ScratchJr server could not be reached. Check the network, then try again.', () => window.location.reload());
  }

  // Only teachers and admins look at a student's work (the server checks
  // which students); a student always gets their own.
  let studentId = viewingStudentId();
  if (studentId && me.role === 'student') {
    forgetViewing();
    studentId = null;
  }

  try {
    // Anything a previous page could not save goes first, so the data below
    // includes it. Whatever still fails stays in storage for the tablet's queue.
    const leftover = new SaveQueue(me.id);
    if (leftover.size) await leftover.flushInBackground();

    const [SQL, state] = await Promise.all([
      window.initSqlJs({locateFile: file => 'lib/' + file}),
      fetchJson(studentId ? `/api/admin/students/${studentId}/state` : '/api/state'),
    ]);
    const viewing = studentId ? state.student : null;
    window.tablet = new WebTablet({SQL, user: me, state, viewing});
    emit('sjr-ready', {user: me, viewing});
  } catch (error) {
    if (error.status === 401) return goToLogin();
    // The student is gone or out of this teacher's sections, or the account is no longer staff.
    if (studentId && (error.status === 403 || error.status === 404)) return stopViewing();
    console.error(error);
    showStartupError(error.message || 'Your projects could not be loaded.', () => window.location.reload());
  }
}
