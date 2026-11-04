//
//  main.js  - this is the entry point to the electron process
//  it is the main process that has access to the filesystem
//  and runs a js version of sql called sql.js to keep track of
//  created projects.
//
//  conceptually, the electron process itself is like a chrome process.
//  it one or more browser windows in their own processes (renderer processes)
//
//  the guts of scratchjr are running inside the renderer process.
//
//  ipcMain calls are usually called by ipcRenderer calls from another
//  file called electronClient.js


// The database we use is a sql lite database which is loaded in from
// a file in the documents directory.  if the file is not there, one is created.
// We use sql.js to manage the database, because the database is fairly small and
// not very complex.

const path = require('path');
const process = require('process');
const url = require('url');
const fs = require('fs');
const util = require('util');

const crypto = require('crypto');

let isDev =  require('electron-is-dev');

isDev = (isDev) || process.env.DEBUG_SCRATCHJR;


/* eslint-disable import/extensions */  // --> OFF
/* eslint-disable import/no-extraneous-dependencies */  // --> OFF
/* eslint-disable import/no-unresolved  */  // --> OFF

const { app, dialog, BrowserWindow, BrowserView, ipcMain, Menu } = require('electron');  



/* eslint-enable import/extensions */  // --> ON
/* eslint-enable import/no-extraneous-dependencies */  // --> ON
/* eslint-enable import/no-unresolved  */  // --> ON

const branding = require('./branding');
const log = require('./log');

// MCP integration.
// The ScratchJr MCP server drives this window over the Chrome DevTools
// Protocol, so the port has to be open before the app is ready. Without this
// the server can only talk to an instance it launched itself, which means a
// child cannot already have the app open when an adult starts a session.
// Loopback only: the debugger is never reachable from another machine.
if (branding.mcpDebugPort) {
  app.commandLine.appendSwitch('remote-debugging-port', String(branding.mcpDebugPort));
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
}

// Escape hatch for testing a source build: point it at a throwaway Documents
// root so it cannot touch the projects of an installed copy.
if (process.env.SCRATCHJR_DOCUMENTS) {
  app.setPath('documents', process.env.SCRATCHJR_DOCUMENTS);
}



const DEBUG =  isDev;
// Read by electronClient.js from inside the editor <webview>, which cannot see
// the window options the flag used to travel on.
global.scratchJrDebug = DEBUG;
const DEBUG_DATABASE      = DEBUG && false;
const DEBUG_FILEIO        = DEBUG && true;
const DEBUG_RESOURCEIO    = DEBUG && false;
const DEBUG_CLEANASSETS   = DEBUG && false;
const DEBUG_NYI           = DEBUG && true;
// DevTools occupies the page's single debugger slot, which would lock the MCP
// server out of a source build. Opt in with SCRATCHJR_DEVTOOLS=1 instead.
const DEBUG_LOAD_DEVTOOLS = DEBUG && (!branding.mcpDebugPort || process.env.SCRATCHJR_DEVTOOLS === '1');




// Debugging the electron process:
// note to use a debugger use 'npm run debugMain' and load up chrome://inspect
// ============================================================================
// use one wrapper for debugging so we can turn it on and off at a
// central place
function debugLog(...args) {
  if (DEBUG) {
    console.log(args); // eslint-disable-line no-console
  }
}
process.on('uncaughtException', (err) => {
  debugLog('uncaughtException', err);
  process.exit();
});
process.on('unhandledRejection', (reason, p) => {
  debugLog('unhandledRejection', reason, p);
  process.exit();
});



// SQL JS adds its own uncaughtException handler  - so we need to register ours first.
const SQL = require('sql.js');



if (require('electron-squirrel-startup')) app.quit(); // eslint-disable-line global-require

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win;
let dataStore;
let editorContents;
let settingsWindow;
let aboutWindow;
// Width the window is currently carrying for the panel, so closing it gives
// back exactly what opening it took.
let lastPanelWidth = 0;

// The editor needs 1000x800 to itself; the assistant panel is extra on top of
// that, which is why the first window is opened wider when the screen allows.
// The screen module throws if it is touched before the app is ready, so it is
// fetched where it is used rather than with the rest of the requires.
function workAreaFor(window) {
  const screen = require('electron').screen;
  return window ? screen.getDisplayMatching(window.getBounds()).workArea : screen.getPrimaryDisplay().workArea;
}

const MIN_WINDOW_WIDTH = 1000;
const MIN_WINDOW_HEIGHT = 800;
const PREFERRED_WINDOW_WIDTH = 1420;

function createWindow() {
  // Create the browser window.

  const area = workAreaFor(null);

  win = new BrowserWindow(
    {
      width: Math.max(MIN_WINDOW_WIDTH, Math.min(PREFERRED_WINDOW_WIDTH, area.width)),
      height: Math.max(MIN_WINDOW_HEIGHT, Math.min(900, area.height)),
      minHeight: MIN_WINDOW_HEIGHT,
      minWidth: MIN_WINDOW_WIDTH,
      title: branding.windowTitle,
      customVar: 'elephants',
      isDebug: DEBUG
    });

  // Each page sets its own <title>, which would otherwise replace ours.
  win.on('page-title-updated', (event) => {
    event.preventDefault();
    win.setTitle(branding.windowTitle);
  });

  log.info('Main window created', {width: win.getSize()[0], height: win.getSize()[1]});

  dataStore = new ScratchJRDataStore(win);

  // The editor runs inside a <webview> in the shell page rather than directly in
  // the window. That gives it its own viewport, so its percentage-based layout
  // shrinks to the top pane, and its own debugger target, so the MCP server
  // attaches to the editor instead of to the assistant panel around it.
  win.webContents.on('did-attach-webview', (event, guest) => {
    editorContents = guest;
    dataStore.setEditorContents(guest);
  });

  win.loadURL(url.format({
    pathname: path.join(__dirname, 'shell/shell.html'),
    protocol: 'file',
    slashes: true,

  }));

  if (DEBUG_LOAD_DEVTOOLS) {
    // Open the DevTools.
    win.webContents.openDevTools();
  }

  // Emitted when the window is closed.
  win.on('closed', () => {
    log.info('Main window closed');
    // save the database if it has been opened.
    if (dataStore.databaseManager) {
      dataStore.databaseManager.save();
    }

    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    win = null;
  });

  win.webContents.on('did-finish-load', () => {
  });
}


// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
// A small modal beside the main window: Settings and About share the shape.
function openDialog(file, options) {
  const dialogWindow = new BrowserWindow({
    width: options.width,
    height: options.height,
    parent: win,
    modal: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: options.title,
    autoHideMenuBar: true,
    show: false
  });
  dialogWindow.setMenu(null);
  dialogWindow.loadURL(url.format({
    pathname: path.join(__dirname, 'windows', file),
    protocol: 'file',
    slashes: true
  }));
  dialogWindow.once('ready-to-show', () => dialogWindow.show());
  dialogWindow.on('page-title-updated', (event) => event.preventDefault());
  return dialogWindow;
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.focus(); return; }
  settingsWindow = openDialog('settings.html', {width: 540, height: 640, title: 'Assistant Settings'});
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

function openAboutWindow() {
  if (aboutWindow && !aboutWindow.isDestroyed()) { aboutWindow.focus(); return; }
  aboutWindow = openDialog('about.html', {width: 480, height: 540, title: 'About ' + branding.productName});
  aboutWindow.on('closed', () => { aboutWindow = null; });
}

// Save to / load from the computer ===========================================
// A project travels as an .sjr file, the archive the tablet apps share, so it
// opens in ScratchJr on an iPad or Android tablet too. The editor page packs and
// unpacks it (src/app/src/desktop/ProjectFile.js); this side owns the dialogs
// and the disk.

const PROJECT_FILE_FILTERS = [{name: 'ScratchJr Project', extensions: ['sjr']}];
// Far above any real project; a bigger file is not one, and would have to cross
// to the page as base64 in a single message.
const MAX_PROJECT_FILE_BYTES = 64 * 1024 * 1024;
// Where the last project was saved or loaded, so the next dialog starts there.
let lastProjectFolder = null;

function projectFolder() {
  return lastProjectFolder || app.getPath('documents');
}

function showProjectFileMessage(title, message, detail) {
  if (!win || win.isDestroyed()) return;
  dialog.showMessageBox(win, {type: detail ? 'warning' : 'info', buttons: ['OK'], title: title, message: message, detail: detail || ''});
}

function editorReady() {
  if (editorContents && !editorContents.isDestroyed()) return true;
  showProjectFileMessage(branding.productName, 'ScratchJr is still starting. Try again in a moment.');
  return false;
}

// The page saves the open project and packs it, then answers with
// project-file-packaged.
function saveProjectToComputer() {
  if (!editorReady()) return;
  editorContents.send('project-file-save');
}

function loadProjectFromComputer() {
  if (!editorReady()) return;

  const picked = dialog.showOpenDialog(win, {
    title: 'Load Project from Computer',
    defaultPath: projectFolder(),
    filters: PROJECT_FILE_FILTERS,
    properties: ['openFile']
  });
  if (!picked || !picked.length) return;

  const file = picked[0];
  lastProjectFolder = path.dirname(file);

  let contents;
  try {
    if (fs.statSync(file).size > MAX_PROJECT_FILE_BYTES) {
      showProjectFileMessage('Load Project', 'That file is too big to be a ScratchJr project.', file);
      return;
    }
    contents = fs.readFileSync(file);
  } catch (error) {
    log.error('Could not read project file', {file, error: error.message});
    showProjectFileMessage('Load Project', 'That file could not be opened.', error.message);
    return;
  }

  // An .sjr is a zip archive, which always starts with "PK".
  if (contents.length < 4 || contents[0] !== 0x50 || contents[1] !== 0x4b) {
    showProjectFileMessage('Load Project', 'That file is not a ScratchJr project.', file);
    return;
  }

  log.info('Loading project from file', {file, bytes: contents.length});
  editorContents.send('project-file-load', {fileName: path.basename(file), data: contents.toString('base64')});
}

ipcMain.on('project-file-packaged', (event, packed) => {
  if (!win || win.isDestroyed()) return;

  const target = dialog.showSaveDialog(win, {
    title: 'Save Project to Computer',
    defaultPath: path.join(projectFolder(), `${(packed && packed.fileName) || 'Project'}.sjr`),
    filters: PROJECT_FILE_FILTERS
  });
  if (!target) return;
  lastProjectFolder = path.dirname(target);

  try {
    fs.writeFileSync(target, Buffer.from(packed.data, 'base64'));
    log.info('Project saved to file', {file: target});
  } catch (error) {
    log.error('Could not save project file', {file: target, error: error.message});
    showProjectFileMessage('Save Project', 'The project could not be saved there.', error.message);
  }
});

ipcMain.on('project-file-result', (event, result) => {
  result = result || {};
  if (!result.error) {
    log.info('Project loaded from file', {file: result.fileName});
    return;
  }
  log.warn(`Project ${result.action} did not finish`, result);
  const title = result.action === 'load' ? 'Load Project' : 'Save Project';
  showProjectFileMessage(title, result.error, [result.fileName, result.detail].filter(Boolean).join('\n'));
});

ipcMain.on('open-ai-settings', () => openSettingsWindow());

ipcMain.on('ai-settings-saved', () => {
  log.info('Assistant settings saved');
  if (win && !win.isDestroyed()) win.webContents.send('ai-settings-changed');
});

// Anything the panel wants in the log goes through here, so one file holds both
// processes in the order things actually happened.
ipcMain.on('log-entry', (event, entry) => {
  const level = entry && entry.level === 'error' ? 'error' : entry && entry.level === 'warn' ? 'warn' : 'info';
  log[level]((entry && entry.message) || '(no message)', entry && entry.detail);
});

// A crash that reaches here would otherwise be a dialog and nothing else.
process.on('uncaughtException', error => {
  log.error('Uncaught exception in the main process', error);
  throw error;
});

// The assistant panel takes its width out of the editor's, and ScratchJr's own
// frame stops laying out below 766px. So the window carries the panel rather
// than the editor paying for it: opening it widens the window, closing it gives
// that width back, and the minimum size is moved so it cannot be dragged into
// squeezing the editor. A maximised window is left alone - there is nowhere to
// grow to, and the editor still has room on any normal screen.
ipcMain.on('assistant-layout', (event, layout) => {
  if (!win || win.isDestroyed()) return;

  const editorMin = Number(layout.editorMinWidth) || 766;
  const panel = layout.visible ? Math.round(Number(layout.width) || 0) : 0;
  const frame = win.getSize()[0] - win.getContentSize()[0];
  const minimum = Math.max(MIN_WINDOW_WIDTH, editorMin + panel + frame);

  win.setMinimumSize(minimum, MIN_WINDOW_HEIGHT);
  log.info('Assistant panel layout', {visible: Boolean(layout.visible), width: panel, reason: layout.reason, windowMinimum: minimum});

  // Recorded even when the window is not resized, so that hiding the panel
  // later gives back the width it is actually holding.
  const carried = lastPanelWidth;
  lastPanelWidth = panel;

  // Only the tab moves the window. Startup keeps the size the user left it at,
  // and a drag is already the width they asked for.
  if (layout.reason !== 'toggle' || win.isMaximized() || win.isFullScreen()) return;

  const [width, height] = win.getSize();
  const wanted = layout.visible ? width + panel : width - carried;

  const area = workAreaFor(win);
  const target = Math.max(minimum, Math.min(wanted, area.width));
  if (target === width) return;

  win.setSize(target, height);
  // Growing rightwards can push the window off the screen edge; slide it back.
  const bounds = win.getBounds();
  const overflow = (bounds.x + bounds.width) - (area.x + area.width);
  if (overflow > 0) win.setPosition(Math.max(area.x, bounds.x - overflow), bounds.y);
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {

  log.prune();
  log.info('App started', {
    version: branding.version,
    platform: `${process.platform} ${process.arch}`,
    electron: process.versions.electron,
    node: process.versions.node,
    mcpDebugPort: branding.mcpDebugPort || 'off',
    logs: log.directory()
  });

  createWindow();

  const fileItems = [];
  fileItems.push({label: 'Save Project to Computer...', accelerator: 'CmdOrCtrl+S', click: saveProjectToComputer});
  fileItems.push({label: 'Load Project from Computer...', accelerator: 'CmdOrCtrl+O', click: loadProjectFromComputer});
  fileItems.push({type: 'separator'});
  if (dataStore.hasRestoreDatabase()) {
    fileItems.push({label: 'Restore projects', click: dataStore.restoreProjects.bind(dataStore)});
    fileItems.push({type: 'separator'});
  }
  fileItems.push({label: 'Settings...', accelerator: 'CmdOrCtrl+,', click: openSettingsWindow});
  fileItems.push({label: 'About ' + branding.productName, click: openAboutWindow});
  fileItems.push({type: 'separator'});
  fileItems.push({role: 'quit'});

  const menu = Menu.buildFromTemplate([{label: 'File', submenu: fileItems}]);
  Menu.setApplicationMenu(menu);

});

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  //if (process.platform !== 'darwin') {
    // since we don't have a window menu we have to exit, even on mac.

    app.quit();
  //}
});

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (win === null) {
    createWindow();
  }
});














// ipcMain calls for the tabletInterface =======================================

/** returns if we are in a debug mode */
ipcMain.on('io_getIsDebug', (event, arg) =>  { // eslint-disable-line  no-unused-vars
	event.returnValue = DEBUG; 
	
});

ipcMain.on('debugWriteLog', (event, args) =>  { // eslint-disable-line  no-unused-vars
	debugLog(args); // send to our debugLog which will write to a file.
	event.returnValue = true;
});

/**
* Clean any assets that are not referenced in the database
*
* @param fileType The extension of the type of file to clean
*/
ipcMain.on('io_cleanassets', (event, fileType) => {
  if (DEBUG_NYI) debugLog('cleanAssets - ', fileType);
  const db = dataStore.getDatabaseManager();
  if (db) {
    db.cleanProjectFiles(fileType);
  }
  event.returnValue = true;
});

/** Sets the file with the given name to the given contents
    java version writes byte array using Base64.decode
 */
ipcMain.on('io_setfile', (event, arg) => {
  if (DEBUG_FILEIO) debugLog('io_setfile', arg);

  event.returnValue = dataStore.writeProjectFile(arg.name, arg.contents, { encoding: 'utf8' });
});

/** Gets a base64-encoded view of the contents of the given file
    java version returns Base64.encodeToString
*/
ipcMain.on('io_getfile', (event, arg) => {
  if (DEBUG_FILEIO) debugLog('io_getfile', arg);

  event.returnValue = dataStore.readProjectFileAsBase64EncodedString(arg);
});


/**
 * Returns the media data associated with the given filename and return the result base64-encoded.
 * NOTE: appears to be the same as getfile??
 */
ipcMain.on('io_getmedia', (event, filename) => {
  if (DEBUG_FILEIO)debugLog('io_getmedia', filename);


  event.returnValue = dataStore.readProjectFileAsBase64EncodedString(filename);
});


/**
 * Allows incremental loading of large resources
 *
 * This API loads an entire file and then encodes it to
 * base 64 string and sends it chunk by chunk.
 *     Unnecessary for loading from disk... can we remove?
 */

ipcMain.on('io_getmediadata', (event, key, offset, length) => {
  if (DEBUG_FILEIO) debugLog('io_getmediadata', key, offset, length);

  const mediaString = dataStore.getCachedMedia(key);

  if (mediaString) {
    try {
      event.returnValue = mediaString.substring(offset, offset + length); 
    } catch (e) {
      debugLog('error parsing media');
    }
    return;
  }
  event.returnValue = null;
});

ipcMain.on('io_getmediadone', (event, key) => {
  if (DEBUG_FILEIO) debugLog('io_getmediadone', key);


  dataStore.removeFromMediaCache(key);
  event.returnValue = true;
});

ipcMain.on('io_getmedialen', (event, file, key) => {
  if (DEBUG_FILEIO) debugLog('io_getmedialen', file, key);

  const encodedStr = dataStore.readProjectFileAsBase64EncodedString(file);
  dataStore.cacheMedia(key, encodedStr);

  event.returnValue = (encodedStr) ? encodedStr.length : 0;
});

/**
 * Store the given content in a filereadProjectFileAsBase64EncodedString whose filename is constructed using the md5 sum of the base64 content string
 * followed by the given extension, and return the filename.
 *
 * @param base64ContentStr Base64-encoded content to store in the file
 * @param extension The extension of the filename to store to
 * @return The filename of the file that was saved.
 */
ipcMain.on('io_setmedia', (event, base64ContentStr, ext) => {
  if (DEBUG_FILEIO) debugLog('io_setmedia - write file', ext);

  const filename = `${dataStore.getMD5(base64ContentStr)}.${ext}`;
  dataStore.writeProjectFile(filename, base64ContentStr, { encoding: 'base64' });

  event.returnValue = filename;
});


/**
 * Writes the given base64-encoded content to a filename with the name key.ext.
 */

ipcMain.on('io_setmedianame', (event, encodedData, key, ext) => {
  if (DEBUG_FILEIO) debugLog('io_setmedianame', key, ext);

  const filename = `${key}.${ext}`;
  dataStore.writeProjectFile(filename, encodedData, { encoding: 'base64' });
  event.returnValue = filename;
});

/**
*  gets the app wide settings.
*  UNDONE - ask for permission for sound and video
*/
ipcMain.on('io_getsettings', (event, arg) => {
  if (DEBUG_RESOURCEIO) debugLog('io_getsettings', arg);

  try {
    // NSString *choice =[[NSUserDefaults standardUserDefaults] stringForKey:@"debugstate"];
    // return [NSString stringWithFormat: @"%@,%@,%@,%@", [NSHomeDirectory() stringByAppendingPathComponent:@"Documents"],
    // choice, [RecordSound getPermission], [ViewFinder cameraHasPermission]];

    const documents = app.getPath('documents');
    event.returnValue = `${path.join(documents, 'ScratchJR')},false,YES,YES`;
  } catch (e) {
    event.returnValue = null;

    debugLog('io_getsettings', e);
  }
});


/**
*  get an MD5 checksum of data.
*/
ipcMain.on('io_getmd5', (event, data) => {
  if (DEBUG_FILEIO) debugLog('io_getmd5');
  try {
    event.returnValue = dataStore.getMD5(data);
  } catch (e) {
    event.returnValue = null;
    debugLog('io_getmd5', e);
  }
});

/**
*  removes a file from the PROJECTFILES table
*/
ipcMain.on('io_remove', (event, filename) => {
  if (DEBUG_FILEIO) debugLog('io_remove: ', filename);
  dataStore.removeProjectFile(filename);
  event.returnValue = true;
});


ipcMain.on('io_gettextresource', (event, filename) => {
  if (DEBUG_RESOURCEIO) debugLog('io_gettextresource', filename);


    // returns a file from the app resource directory
  const filePath = dataStore.safeGetFilenameInAppDirectory(filename, true);


  if (filePath) {
    const data = fs.readFileSync(filePath, 'utf8');
    event.returnValue = data;
  } else {
    debugLog('io_gettextresource: File could not be resolved.', filename);

    event.returnValue = null;
  }
});


/** search for audio data 
	first look for app/src/samples
	then look for  app/src/sounds
	then look in db for the audio name
*/
ipcMain.on('io_getAudioData', (event, audioName) => {
   if (DEBUG_FILEIO) debugLog('io_getAudioData - looking for', audioName);
  
   
    // try fishing out of the app directory first - samples/pig.wav
  let filePath = dataStore.safeGetFilenameInAppDirectory(audioName, false);

  if (!filePath) { // if not pull from the sounds directory
    filePath = dataStore.safeGetFilenameInAppDirectory(`sounds/${audioName}`, false);
  }


  
  if (!filePath) { // if not pull from the scratch document folder.
  	if (DEBUG_FILEIO) debugLog('...trying to look in the PROJECTFILE table', audioName);
   
   	// this is already stored as a string, we do not need to convert it
     let projectDBFile = dataStore.readProjectFileAsBase64EncodedString(audioName);
     if (DEBUG_FILEIO && !projectDBFile) debugLog('...WARNING: unable to find: ',  audioName);
     event.returnValue = projectDBFile;
	return;
  }
  
  
  const  data = fs.readFileSync(filePath);
  
  if (!data) {
  	if (DEBUG_FILEIO) debugLog('io_getAudioData - could not find on disk', audioName, filePath);
  
    event.returnValue = null;
    return;
  }

  const dataStr = new Buffer(data).toString('base64');
  const extension = path.extname(filePath);
  if (extension === '.mp3') {
    event.returnValue = `data:audio/mp3;base64,${dataStr}`;
  } else if (extension === '.wav') {
    event.returnValue = `data:audio/wav;base64,${dataStr}`;
  } else {
    event.returnValue = null;
  }
});

ipcMain.on('database_stmt', (event, json) => {
// {"stmt":"select name,thumbnail,id,isgift from projects where deleted = ? AND version = ? AND gallery IS NULL order by ctime desc","values":["NO","iOSv01"]}
  if (DEBUG_DATABASE) debugLog('database_stmt', json);

  const db = dataStore.getDatabaseManager();
  event.returnValue = db.stmt(json);


  if (DEBUG_DATABASE) debugLog('database_stmt result:', event.returnValue);
});
ipcMain.on('database_query', (event, json) => {
  if (DEBUG_DATABASE) debugLog('database_query', json);

  const db = dataStore.getDatabaseManager();

  event.returnValue = JSON.stringify(db.query(json));
});


class ScratchJRDataStore {

  constructor(electronBrowserWindow) {
        /** Cache of key to base64-encoded media value */
    this.mediaStrings = {};
    this.electronBrowserWindow = electronBrowserWindow; 
    // Set once the editor <webview> attaches; renderer notifications have to
    // reach the guest rather than the shell page that hosts it.
    this.editorContents = null;
  }
    /** gets an md5 checksum of the data passed in.
        @param {object} data
    */
  getMD5(data) { // eslint-disable class-methods-use-this
    return crypto.createHash('md5').update(data).digest('hex');
  }


  getDatabaseManager() {
    if (!this.databaseManager) {
      const scratchFolder = ScratchJRDataStore.getScratchJRFolder();
      const scratchDBPath = path.join(scratchFolder, 'scratchjr.sqllite');
      this.databaseManager = new DatabaseManager(scratchDBPath);
      if (DEBUG_DATABASE) debugLog('DatabaseManager created');
    }
    return this.databaseManager;
  }

  /** remembers the editor webview so notifications reach the editor, not the shell */
  setEditorContents(contents) {
    this.editorContents = contents;
  }

  /** returns whether there is a scratchjr.sqllite.restore in the Documents/ScratchJR folder */
  hasRestoreDatabase() {
    const scratchFolder = ScratchJRDataStore.getScratchJRFolder();
    const scratchRestoreDB = path.join(scratchFolder, 'scratchjr.sqllite.restore');


	return fs.existsSync(scratchRestoreDB);
  }
    /** copies a scratchjr.sqllite.restore database over the
        existing database.  This is used in a classroom situation
        where you want to reset the projects to a certain configuration
    */
  restoreProjects() {
  	 const scratchFolder = ScratchJRDataStore.getScratchJRFolder();
	 const scratchDBPath = path.join(scratchFolder, 'scratchjr.sqllite');
	 const scratchRestoreDB = path.join(scratchFolder, 'scratchjr.sqllite.restore');
	
  	if (fs.existsSync(scratchRestoreDB)) {
		this.databaseManager = new DatabaseManager(scratchDBPath, scratchRestoreDB);

		if (DEBUG_DATABASE) debugLog('DatabaseManager reloaded from restored copy');

			 // notify the electron client that the database has changed.
			 // electron client will navigate back to the index.html
			 // when it gets ipcRenderer.on('databaseRestored')
		(this.editorContents || this.electronBrowserWindow.webContents).send('databaseRestored', {});
	   
	    dialog.showMessageBox(
	    		this.electronBrowserWindow,
	    		{
					type: 'info',
	    			buttons: ['OK'],
	    			title: 'Database Restored',
	    			message: 'The database has been restored'
	    		},
	    		null /*no callback*/
	    		);

	} else {
	    dialog.showErrorBox('Database Restored', 'The database not been restored.  Could not find file: ' + scratchRestoreDB);
	}
  }


    /** verifies if a file is within the Scratch JR documents folder
        @param {string} fullPath full path to folder
    */
  isInScratchJRFolder(fullPath) {
    if (!fullPath || fullPath.length === 0) return false;
    const testFolder = path.dirname(fullPath);

    const scratchJRPath = ScratchJRDataStore.getScratchJRFolder();
    return (scratchJRPath === testFolder);
  }

  isParentFolder(parent, dir) {
    const relative = path.relative(parent, dir);
    return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
  }


    /** getScratchJRFolder - returns ScratchJR folder in documents */
  static getScratchJRFolder() {
    const documents = app.getPath('documents');
    if (!documents) throw new Error('could not get documents folder');


    const scratchJRPath = path.join(documents, 'ScratchJR');
    this.ensureDir(scratchJRPath);
    return scratchJRPath;
  }
    /** ensureDir ensures folder exists
        @param {string} path

     */

  static ensureDir(filePath) {
    if (!fs.existsSync(filePath)) {
      fs.mkdirSync(filePath);
    }
  }

    /** save a media string to the cache
        @param {string} key
        @param {string} base64EncodedStr string of audio
     */
  cacheMedia(key, base64EncodedStr) {
    this.mediaStrings[key] = base64EncodedStr;
  }

    /** return a media string from the cache */
  getCachedMedia(key) {
    return this.mediaStrings[key];
  }

    /** remove from media cache */
  removeFromMediaCache(key) {
    if (this.mediaStrings[key]) {
      delete this.mediaStrings.key;
    }
  }

    /** looks for a file inside the database, returns as a base64 encoded string
        @param {string} filename inside of PROJECTFILES table
    */
  readProjectFileAsBase64EncodedString(filename) {
    const db = this.getDatabaseManager();
    return db.readProjectFile(filename);
  }

    /** removes a file from the PROJECTFILES table
        @param {string} filename inside of PROJECTFILES table
    */
  removeProjectFile(filename) {
    const db = this.getDatabaseManager();
    db.removeProjectFile(filename);
  }

    /** writes a file to database as a base64 encoded string
        @param {string} filename inside of PROJECTFILES table
        @param {string} contents - base64 encoded string
        @param {string} encoding

    */
  writeProjectFile(file, contents, encoding) {
    const db = this.getDatabaseManager();
    if (db.saveToProjectFiles(file, contents, encoding)) {
      return file;
    }
    return -1;
  }


    /** gets a file from the app directory - usually CSS or some asset
        @param  {string} file  filename relative to application root
        @param {bool} warnIfNotPresent make a warning if not present

     */

  safeGetFilenameInAppDirectory(file, warnIfNotPresent) {
        // if the filename is null throw
    if (!file || file === '') throw new Error('File cannot be null or empty');
    if (!__dirname || __dirname === '') throw new Error('Application dir is empty');


    const appRoot = path.join(__dirname, 'app');


        // join on the application directory
    const filePath = path.join(appRoot, file);
    if (!this.isParentFolder(appRoot, filePath)) {
      throw new Error(`safe resolve path - file outside app folder.${filePath}`);
    }

        // check if the file exists
    if (fs.existsSync(filePath)) {
      return filePath;
    }

    if (DEBUG_FILEIO || warnIfNotPresent) debugLog('safeGetFilenameInAppDirectory: file does not exist.', file, filePath);

            // if not return null.
    return null;
  }
}


// ====== DatabaseManager ==========================================

class DatabaseManager {
  constructor(databaseFilename, databaseRestoreFilename) {
    if (DEBUG_DATABASE) debugLog('DatabaseManager created');

    this.databaseFilename = databaseFilename;
    this.databaseRestoreFilename = databaseRestoreFilename;

    const isFirstTimeRun = !fs.existsSync(this.databaseFilename);

    if (isFirstTimeRun) {
      this.initTables();
      this.runMigrations();
      this.save();
    } else {
      this.open();
      this.runMigrations();
      this.save();
    }
  }

    /** opens the database, (or the restored database, if specified). */
  open() {
    const fileToOpen = (this.databaseRestoreFilename) ? this.databaseRestoreFilename : this.databaseFilename;

    const filebuffer = fs.readFileSync(fileToOpen);


        // Load the db
    this.db = new SQL.Database(filebuffer);
    this.db.handleError = this.handleError;

        // save over the old file if we are restoring
    if (this.databaseRestoreFilename) {
      this.save();
    }
  }

    /** don't throw if there is a database error */
  handleError(e) {
    if (DEBUG_DATABASE) debugLog(e);
  }

    /** close the database */
  close() {
    if (this.db) this.db.close();
    this.db = null;
  }

    /** returns if the database has been opened */
  isOpen() {
    return (this.db != null);
  }

    /** saves the database to the file specified in this.databaseFilename */
  save() {
    const data = this.db.export();
    const buffer = new Buffer(data);
    fs.writeFileSync(this.databaseFilename, buffer);
  }


    /** removes all unused files of a specific filetype, e.g. unused svg files
        @param {string} fileType  note will be of format "wav" - not ".wav"
    */
  cleanProjectFiles(fileType) {
        // we don't use wav files, so translate that to webm.
        if (fileType === 'wav') {
            fileType = 'webm';
        }


        const queryListAllFilesWithExtension = {
            stmt: `select MD5 FROM PROJECTFILES WHERE MD5 LIKE "%.${fileType}"`,
        };

        const allProjectFilesWithExtension = this.query(queryListAllFilesWithExtension);

        for (let i = 0; i < allProjectFilesWithExtension.length; i++) {
            const currentFileToCheck = allProjectFilesWithExtension[i].MD5;

            if (!currentFileToCheck) continue;

            if (DEBUG_CLEANASSETS) debugLog('checking if in use: ', currentFileToCheck);


            const queryFindFileInProjects = {
                stmt: `select ID from PROJECTS where json like "%${currentFileToCheck}%"`,
            };
        
            // search in the JSON field of the PROJECTS table 
            const projectJSON = this.query(queryFindFileInProjects);
            if (projectJSON.length > 0) {
                if (DEBUG_CLEANASSETS) debugLog('...project is currently using: ', currentFileToCheck);
                continue; // we don't need to keep checking this file, it is being used
            }


            // search in the usershapes table
            const queryFindFileInUsershapes = {
                stmt: `select MD5 from USERSHAPES where MD5 = "${currentFileToCheck}"`,
            };


            const shapeFiles = this.query(queryFindFileInUsershapes);
            if (shapeFiles.length > 0) {
                if (DEBUG_CLEANASSETS) debugLog('...user shapes is using: ', currentFileToCheck, shapeFiles);
                continue; // we don't need to keep checking this file, it is being used
            }


            // search in the userbackgrounds table
            const queryFindFileInUserbkgs = {
                stmt: `select MD5 from USERBKGS where MD5 = "${currentFileToCheck}"`,
            };
            const bkgFiles = this.query(queryFindFileInUserbkgs);
            if (bkgFiles.length > 0) {
                if (DEBUG_CLEANASSETS) debugLog('...user backgrounds is using: ', currentFileToCheck, bkgFiles);
                continue; // we don't need to keep checking this file, it is being used
            }


                // if the file is not being used, remove it
            if (DEBUG_CLEANASSETS) debugLog('...not in use, removing: ', currentFileToCheck);

            this.removeProjectFile(currentFileToCheck);
        }
        this.save();
  }

  removeProjectFile(fileMD5) {
    const json = {};
    json.cond = 'MD5 = ?';
    json.items = ['CONTENTS'];
    json.values = [fileMD5];
    const table = 'PROJECTFILES';


    json.stmt = `delete from ${table
            } where ${json.cond}`;


    this.query(json);
    
    this.save(); // flush the database to disk.
    
  }
    /** loads a file from the PROJECTFILES table
        @param {string} fileMD5 filename
    */
  readProjectFile(fileMD5) {
    const json = {};
    json.cond = 'MD5 = ?';
    json.items = ['CONTENTS'];
    json.values = [fileMD5];
    const table = 'PROJECTFILES';


    json.stmt = `select ${json.items} from ${table
            } where ${json.cond}${json.order ? ` order by ${json.order}` : ''}`;


    const rows = this.query(json);

    if (rows.length > 0) {
      return rows[0].CONTENTS;
    }
    return null;
  }

  saveToProjectFiles(fileMD5, content) {
    const json = {};
    const keylist = ['md5', 'contents'];
    const values = '?,?';
    json.values = [fileMD5, content];
    json.stmt = `insert into projectfiles (${keylist.toString()}) values (${values})`;
    var insertSQLResult = this.stmt(json);
    
    this.save(); // flush the database to disk.
    
    return (insertSQLResult >= 0);
  }

    /** returns a key value pairing of the database result */
  getRowData(res) {
    return res.getAsObject();
  }

    /** initialize the ScratchJR database.
    The Electron version has one more table which is PROJECTFILES
    This helps us store all the files in one database which can be easily saved/restored.
    */
  initTables() {
    if (this.db) throw new Error('database already created');
    this.db = new SQL.Database();
    this.db.handleError = this.handleError;

    if (DEBUG_DATABASE) debugLog('making tables...');

    this.db.exec('CREATE TABLE IF NOT EXISTS PROJECTS (ID INTEGER PRIMARY KEY AUTOINCREMENT, CTIME DATETIME DEFAULT CURRENT_TIMESTAMP, MTIME DATETIME, ALTMD5 TEXT, POS INTEGER, NAME TEXT, JSON TEXT, THUMBNAIL TEXT, OWNER TEXT, GALLERY TEXT, DELETED TEXT, VERSION TEXT)\n');
    this.db.exec('CREATE TABLE IF NOT EXISTS USERSHAPES (ID INTEGER PRIMARY KEY AUTOINCREMENT, CTIME DATETIME DEFAULT CURRENT_TIMESTAMP, MD5 TEXT, ALTMD5 TEXT, WIDTH TEXT, HEIGHT TEXT, EXT TEXT, NAME TEXT, OWNER TEXT, SCALE TEXT, VERSION TEXT)\n');
    this.db.exec('CREATE TABLE IF NOT EXISTS USERBKGS (ID INTEGER PRIMARY KEY AUTOINCREMENT, CTIME DATETIME DEFAULT CURRENT_TIMESTAMP, MD5 TEXT, ALTMD5 TEXT, WIDTH TEXT, HEIGHT TEXT, EXT TEXT, OWNER TEXT,  VERSION TEXT)\n');


    this.db.exec('CREATE TABLE IF NOT EXISTS PROJECTFILES (MD5 TEXT PRIMARY KEY, CONTENTS TEXT)\n');
  }

  clearTables() {
    this.db.exec('DELETE FROM PROJECTS');
    this.db.exec('DELETE FROM USERSHAPES');
    this.db.exec('DELETE FROM USERBKGS');
  }
  runMigrations() {
    try {
      this.db.exec('ALTER TABLE PROJECTS ADD COLUMN ISGIFT INTEGER DEFAULT 0');
    } catch (e) {
      debugLog('failed to migrate tables', e);
    }
  }


    /**
    runs a sql query on the database, returns the number of rows from the result
    @param {json} json object with stmt and values filled out
    @returns lastRowId
    */
  stmt(jsonStrOrJsonObj) {
  
  
    try {
        // {"stmt":"select name,thumbnail,id,isgift from projects where deleted = ? AND version = ? AND gallery IS NULL order by ctime desc","values":["NO","iOSv01"]}

            // if it's a string, parse it.  if not, use it if it's not null.
      const json = (typeof jsonStrOrJsonObj === 'string') ? JSON.parse(jsonStrOrJsonObj) : jsonStrOrJsonObj || {};
      const stmt = json.stmt;
      const values = json.values;


    
      if (DEBUG_DATABASE) debugLog('DatabaseManager executing stmt', stmt, values);

      const statement = this.db.prepare(stmt, values);

      while (statement.step()) statement.get();
            // return JSON.stringify(statement.getAsObject());

      const result = this.db.exec('select last_insert_rowid();');

      const lastRowId = result[0].values[0][0];

      return lastRowId;
    } catch (e) {
      if (DEBUG_DATABASE) debugLog('stmt failed', jsonStrOrJsonObj, e);

      return -1;
    }
  }

    /**
    runs a sql query on the database, returns the results of the SQL statment
    @param {json} json object with stmt and values filled out - can be a string or object

    @returns lastRowId
    */
  query(jsonStrOrJsonObj) {
    
    try {    
      // if it's a string, parse it.  if not, use it if it's not null.
      const json = (typeof jsonStrOrJsonObj === 'string') ? JSON.parse(jsonStrOrJsonObj) : jsonStrOrJsonObj || {};

      const stmt = json.stmt;
      const values = json.values;

      const statement = this.db.prepare(stmt, values);


      const rows = [];
      while (statement.step()) {
        rows.push(statement.getAsObject());
      }

      return rows;
    } catch (e) {
      if (DEBUG_DATABASE) debugLog('query failed', jsonStrOrJsonObj, e);

      return [];
    }
  }

}

var logFile = fs.createWriteStream(path.join(ScratchJRDataStore.getScratchJRFolder(), 'debug.log'), { flags: 'a' });
  // Or 'w' to truncate the file every time the process starts.
var logStdout = process.stdout;

console.log = function () {  // eslint-disable-line no-console
  logFile.write(util.format.apply(null, arguments) + '\n'); // eslint-disable-line prefer-rest-params
  logStdout.write(util.format.apply(null, arguments) + '\n'); // eslint-disable-line prefer-rest-params
};

console.error = console.log;  // eslint-disable-line no-console

