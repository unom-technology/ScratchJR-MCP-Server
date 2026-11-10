# Upstream and local modifications

This directory is a vendored copy of [jfo8000/ScratchJr-Desktop](https://github.com/jfo8000/ScratchJr-Desktop),
the open-source community port of MIT's ScratchJr.

- Upstream commit: `919482d724904a560d6c77dab06240341584c502` ("Update index.html", 2020-11-22)
- Upstream licence: MIT (see `LICENSE`)

The `.git` directory of the upstream clone was removed so that these files are tracked by the
ScratchJR-MCP repository itself. To compare against upstream again:

```sh
git clone https://github.com/jfo8000/ScratchJr-Desktop.git /tmp/sjr-upstream
diff -ru /tmp/sjr-upstream desktop --exclude node_modules --exclude .git --exclude out
```

## What was changed

Every change is listed here so the fork stays easy to re-apply to a newer upstream.

### `src/branding.js` (new file)

Holds the product name, version, installer name and MCP debug port. Renaming the fork is a
one-file change; nothing else hardcodes the name.

### `src/main.js`

1. Requires `./branding`.
2. Opens the Chrome DevTools Protocol on `127.0.0.1:<mcpDebugPort>` (9223 by default) before the
   app becomes ready. This is what lets the ScratchJR MCP server attach to a window the user
   opened themselves, instead of only to one the server launched.
3. Honours `SCRATCHJR_DOCUMENTS` as an override for the Documents root, so a test build cannot
   write into the projects of an installed copy.
4. Only opens DevTools when the MCP port is disabled or `SCRATCHJR_DEVTOOLS=1` is set. DevTools
   occupies the page's single debugger slot, which would otherwise lock the MCP server out.
5. Sets the window title from `branding.windowTitle` and keeps it there when a page changes its
   own `<title>`.
6. Loads `shell/shell.html` and routes `databaseRestored` to the editor webview rather than to the
   window, which now hosts the chat panel instead of the editor.
7. Adds Settings and About to the File menu, and the small windows they open.
8. Publishes `global.scratchJrDebug` for `electronClient.js` to read from inside the webview.
9. Adds **Save Project to Computer...** (Ctrl+S) and **Load Project from Computer...** (Ctrl+O) to
   the File menu. This side owns the native save and open dialogs and the disk; the editor page
   packs and unpacks the `.sjr` (see `src/app/src/desktop/ProjectFile.js` below). A loaded file is
   refused before it reaches the page if it is over 64 MB or does not start with a zip header.

### `.sjr` save and load (`src/app/src/iPad/IO.js`, `iOS.js`, `src/app/appEntry.js`, `src/app/src/desktop/ProjectFile.js`)

Upstream ships the tablet sharing code but never runs it on the desktop: `shareEnabled` is `false`
and `sendSjrUsingShareDialog` was never implemented. It had also stopped working, since it was
written against JSZip 2 and `package.json` installs JSZip 3, which removed `load()`, `generate()`,
`asText()` and `asBinary()`.

- `IO.zipProject` generates with `generateAsync({type: 'base64'})`. It waits until the packed and
  expected counts are equal rather than until their ratio is 1, which never happened for a project
  with no assets. It skips the thumbnail of a project that has none yet, which is how the MCP
  server's inserted projects start out.
- `IO.loadProjectFromSjr` reads with `JSZip.loadAsync` and now returns a promise that settles
  once the project row and every asset are stored. Each asset's save moved into
  `IO.saveSjrAsset`, with the database calls unchanged. Assets are stored one at a time, and a
  file with an empty name or extension is skipped instead of stalling the lobby refresh forever.
- `IO.getImagesInSVG` calls back when an SVG has `xlink:href` but no `<image>`, and when an
  embedded image fails to load; both used to leave the caller waiting for good.
- `iOS.loadProjectFromSjr` reports errors from the promise.
- `src/app/src/desktop/ProjectFile.js` (new) is the page half of the File menu entries. Saving
  stops the scripts, saves the open project, packs it, and sends it to `main.js`. Loading saves
  the open project first, then imports and goes to the lobby. It talks only to `window.tablet`,
  like the rest of the app code.
- `appEntry.js` calls `ProjectFile.listen(page)` once the Media Lib has loaded, because importing
  needs `MediaLib.keys`.

### `src/app/appEntry.js`: `window.loadPage`

`Lobby.loadLink` calls `loadPage` as a global to start the help pages. Electron runs `appEntry.js`
as a plain script, which makes its functions global by themselves; `web_version` bundles it, which
does not. `appEntry.js` now sets `window.loadPage` explicitly. Nothing changes for the desktop app.

### `src/app/settings.json`

Adds `buildName` and `buildVersion`, which the MCP `scratchjr_status` tool reports.

`scratchJrVersion` is deliberately left at `iOSv01`: the lobby query in `src/main.js` filters
saved projects on that exact value, so changing it would hide every project a child has saved.

### `src/app/*.html`

`<title>` updated on `index.html`, `home.html`, `editor.html` and `gettingstarted.html`.

### `src/shell/` (new directory)

The window now loads `shell/shell.html` instead of the editor directly. It stacks the editor over an assistant chat panel, with a draggable divider between them.

The editor runs inside a `<webview>` rather than in the window itself. That was the whole reason this layout is possible: a webview guest gets its own viewport, so ScratchJr's percentage-based sizing shrinks into the top pane, and it stays its own debugger target, so the MCP server attaches to the editor rather than to the chat page wrapped around it.

Two sizing traps are worth knowing if this CSS is ever touched. A `<webview>` is a replaced element that falls back to 300x150, and Chrome 58 will not resolve a percentage height against a flex-sized parent. `#sjr` is therefore pinned with `position: absolute` on all four edges.

### `src/ai/` (new directory)

- `settings.js` reads and writes `ai-settings.json` in the Electron userData folder, and holds the provider table. Keys, models and server addresses are kept per provider, since none of the four shares them; a file written before those maps existed is migrated once, on the first read that finds no maps in it.
- `mcp.js` starts `src/server.js` as a child process and speaks MCP over stdio. It resolves the server path from `__dirname`, not `app.getAppPath()`, which under electron-forge's dev runner points at Electron's own `default_app.asar`.
- `agent.js` runs the tool-calling loop against the OpenAI chat completions shape, which DeepSeek, OpenRouter, LM Studio and Ollama all accept. The two local providers differ in three ways it has to handle: no `Authorization` header at all (an empty bearer reads as a bad key to anything sitting in front of them), no thinking flag in the request, and thinking that comes back inside `<think>` tags in the ordinary content stream rather than in a field. Those tags are split back out as the stream arrives, which means coping with a tag straddling two deltas, and the thinking is not echoed back on the next round the way DeepSeek requires.
- `node-runtime.js` finds a Node 22+ to run the tool server with, and downloads the portable zip into `userData` when the machine has none. The zip is used rather than the installer so no administrator rights, UAC prompt or `PATH` change is involved, and an existing Node is never touched.

### `src/windows/` (new directory)

The Settings and About dialogs, plus the stylesheet they share.

### `src/electronClient.js`

`const DEBUG = remote.getCurrentWebContents().browserWindowOptions.isDebug` threw inside the webview, because a guest webContents carries no `browserWindowOptions`. It killed the script before `window.tablet` existed, which left the editor blank and the MCP server unable to do anything. The flag now falls back to `remote.getGlobal('scratchJrDebug')`, set in `main.js`.

It also implements `sendSjrUsingShareDialog`, which sends the packed project to `main.js` to be saved
instead of opening a tablet's share sheet. It adds `setProjectFileHandlers` and `projectFileResult`,
and the `project-file-save` and `project-file-load` listeners that connect the File menu to
`ProjectFile.js`.

### `package.json` and `forge.config.js`

Product name, version, author and the Squirrel installer identity. `forge.config.js` reads them
from `src/branding.js`.

Note that the Squirrel installer name (`ScratchJR-AI-Assisted`) cannot match the
displayed product name: Squirrel treats it as a NuGet package id, which allows only letters,
digits, dots, dashes and underscores. It also decides the install path,
`%LOCALAPPDATA%\ScratchJR-AI-Assisted\app-<version>\ScratchJr.exe`.

## Trademark note

MIT's `TRADEMARKS` policy in this directory allows the ScratchJr marks only on a substantially
unmodified build. A build that adds features — such as the MCP bridge — is expected to drop the
marks and use its own name. That matters for public redistribution rather than for a local
build; change `productName` in `src/branding.js` if you intend to publish this.
