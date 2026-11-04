# Title: ScratchJr Desktop MCP Server

## Description:

Create, edit, run, and inspect real ScratchJr Desktop projects through an MCP client such as Claude, Codex, Cursor, or Google Antigravity. This server controls the installed application through a local Electron connection and saves through ScratchJr's own database interface.

Use natural-language requests to build interactive stories, animations, and simple games with characters, backgrounds, text, sounds, and programming blocks. The server also provides screenshots, custom SVG artwork, and automatic database backups.

**Already set up on this PC:** `Scratch.JR [ AI-Assisted ] v1.0.2` is built and installed, and the server dependencies are in place. The `scratchjr` entry is registered with Claude Desktop, Claude Code, and Codex, all three pointing at `C:\Users\SkieHackerYT\Documents\Gitlab\ScratchJR-MCP\src\server.js`. Google Antigravity is registered too, in `%USERPROFILE%\.gemini\config\mcp_config.json`. Restart Claude, start a new Codex session, and refresh Antigravity's MCP server list to load the tools. Cursor is not installed on this PC; section 5 covers it when it is. The installation steps below are for setting up another PC or reinstalling this project.

## Requirements:

| Requirement | Details |
| --- | --- |
| Operating system | Windows with PowerShell; this integration was tested on Windows |
| ScratchJr | Either the bundled build in `desktop/`, `Scratch.JR [ AI-Assisted ] v1.0.2`, or a stock ScratchJr Desktop community port, tested with version 1.3.2 |
| Node.js and npm | Node.js 22 or newer; tested with Node 24. npm is used to install server dependencies |
| AI client | Claude Desktop, Claude Code, Codex, Cursor, or Google Antigravity with local MCP support; run the client on the same Windows PC as ScratchJr |
| CLI registration | Install the Claude Code or Codex CLI and make it available on PATH if you want the setup script to register that client automatically. Claude Desktop setup does not require these CLIs |
| Project files | This repository, including `package.json`, `package-lock.json`, `src/`, `scripts/`, `install.cmd`, and `desktop/` for the bundled build |
| Internet access | Needed to download software, install npm dependencies, and use your AI client |
| Local storage | Write access to ScratchJr's Documents folder and this server's `backups/` and `artifacts/` folders |
| Disk space for the bundled build | Around 1 GB once built: 0.4 GB of dependencies under `desktop/node_modules`, 0.5 GB of build output under `desktop/out` including a 124 MB installer, plus roughly another 0.5 GB used temporarily while packaging. Not needed if you use a stock ScratchJr install |

This integration controls ScratchJr Desktop. The tablet version and Scratch 3 use different integrations.

## Bundled desktop app: Scratch.JR [ AI-Assisted ] v1.0.2

`desktop/` holds a full copy of the ScratchJr Desktop community port with the MCP bridge built into it. The stock app only exposes the local connection this server needs when the server launches the app itself, so a window that a child already had open could not be driven, and the server had to ask for the app to be closed and reopened. The modified build opens that connection on `127.0.0.1:9223` as it starts, so the server attaches to whichever window is already running.

The build also reports its identity through `scratchjr_status`, which returns `build` and `buildVersion` alongside the ScratchJr data version.

It installs to `%LOCALAPPDATA%\ScratchJR-AI-Assisted\app-1.0.2\ScratchJr.exe`. Projects still live in `Documents\ScratchJR\scratchjr.sqllite`, the same file the stock app uses, so existing projects carry over untouched.

See **Installation Setup** below for how to build and install it. `desktop/UPSTREAM.md` records the upstream commit this copy came from and every modification made to it, so the changes can be re-applied to a newer upstream release.

### Saving and loading projects on the computer

ScratchJr keeps every project inside its own database, so on its own there is no file to copy to a USB stick, hand in to a teacher, or keep as a backup. The **File** menu adds two entries for that:

| Menu entry | Shortcut | What it does |
| --- | --- | --- |
| **Save Project to Computer...** | Ctrl+S | Saves the project that is open in the editor, then asks where to put it as a `.sjr` file |
| **Load Project from Computer...** | Ctrl+O | Asks for a `.sjr` file and adds it to **My Projects**, with a gift bow on it like a project shared from a tablet |

A `.sjr` file is the archive ScratchJr's tablet apps use for sharing. It holds the project and any characters, backgrounds and recorded sounds made for it; built-in characters and backgrounds are left out, because every copy of ScratchJr already has them.

- Loading never overwrites anything. A project whose name is already taken is numbered, so loading `Park Friends` twice gives `Park Friends 2` and `Park Friends 3`.
- Loading from inside the editor saves the open project first, then goes to **My Projects** to show the new one.
- Save needs a project open in the editor. The sample projects on the help page cannot be saved this way.
- A file that is not a ScratchJr project, or is damaged, is refused with a message, and nothing is added.
- Both dialogs start in the folder used last, or in Documents the first time.

### Using the stock app instead

The server still works with an unmodified ScratchJr Desktop installation. It looks for the modified build first and falls back to `%LOCALAPPDATA%\ScratchJr\app-*\ScratchJr.exe`, so nothing needs to be uninstalled. With the stock app, the server must launch ScratchJr itself; if the app is already open, it will ask you to save and close it first.

### Renaming the build

Product name, version, installer name, and debug port live in `desktop/src/branding.js`, and nothing else hardcodes them. Note that MIT's trademark policy, in `desktop/TRADEMARKS`, expects a build with added features to drop the ScratchJr marks and use its own name; that matters if you publish the installer rather than build it for yourself.

## Built-in assistant

The app has its own chat panel beside the editor, so a child can ask for a story without Claude Desktop, Codex or any other editor installed. You supply the model - a hosted one with your own API key, or LM Studio or Ollama running on the same computer; the app supplies the tools.

```
+---------------------------+---------------+
|  Scratch.JR editor        |  Assistant    |  <- AI-Assist tab
|                           |  chat         |     on the edge
+---------------------------+---------------+
```

The panel is a side bar on the right, like the chat panel in a code editor. The **AI-Assist** tab on the right-hand edge folds it away and brings it back, and the editor takes the whole window whenever it is shut. The border between the two can be dragged to set the width.

Opening the panel widens the window by the panel's width and closing it gives that width back, so the editor is never the one that pays for the chat. ScratchJr's own layout stops working below 766px wide, so the window will not let itself be made small enough to reach that; a maximised window is left where it is. Which side the panel was left on, and how wide, is remembered between runs.

The panel drives the same MCP tools an external editor would. Internally it starts the server in `src/server.js` as a child process and that server drives the editor back through the debugging port, so one implementation of every tool serves both routes and they cannot drift apart.

### Choosing a provider

Open **File > Settings**. Four providers are offered, all speaking the OpenAI chat completions shape. Two are hosted and need an account; two run on this computer and need neither key nor internet connection:

| Provider | Endpoint | Needs | Where to get it |
| --- | --- | --- | --- |
| DeepSeek | `api.deepseek.com/v1` | An API key, paid per message | [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys) |
| OpenRouter | `openrouter.ai/api/v1` | An API key, paid per message | [openrouter.ai/keys](https://openrouter.ai/keys) |
| LM Studio | `127.0.0.1:1234/v1` | The app running, with its local server started | [lmstudio.ai](https://lmstudio.ai) |
| Ollama | `127.0.0.1:11434/v1` | The app installed; it serves in the background | [ollama.com](https://ollama.com) |

A key, a model and a server address are remembered separately for each provider, so switching between them does not disturb the settings of the one left behind.

#### The hosted providers

**Model** is a drop-down of the models worth picking, with the id the provider actually accepts:

| Provider | Choice | Model id |
| --- | --- | --- |
| DeepSeek | Flash - fast, everyday chat | `deepseek-flash` |
| DeepSeek | V4 Pro - thinks before answering | `deepseek-v4-pro` |
| OpenRouter | DeepSeek Flash (latest) | `~deepseek/deepseek-flash-latest` |
| OpenRouter | DeepSeek Pro (latest) | `~deepseek/deepseek-pro-latest` |
| OpenRouter | V4.1 Flash / V4 Pro, pinned | `deepseek/deepseek-v4.1-flash`, `deepseek/deepseek-v4-pro` |

The OpenRouter `latest` slugs follow DeepSeek as new versions land, so they do not need changing here. The last entry in the drop-down, **Something else**, opens a box for any other id the provider accepts, such as `openai/gpt-4o-mini` on OpenRouter.

Picking a thinking model turns the thinking on in the request, and the panel shows that thinking in a folded block of its own while it arrives.

#### LM Studio and Ollama

Nothing leaves the computer and nothing is charged, but the model has to be running first:

- **LM Studio** - open it, go to the **Developer** tab and start the local server.
- **Ollama** - install it and pull a model, for example `ollama pull qwen3:8b`. It then serves in the background.

**Model** is not a written list here, because it is whatever has been downloaded. **Refresh** asks the server what it has and fills the drop-down; **Test** says whether the server is answering at all. If neither reaches it, **Server address** takes another port, or the address of another machine on the same network.

The assistant builds projects by calling tools, so pick a model that supports tool use - Ollama tags those at [ollama.com/search?c=tools](https://ollama.com/search?c=tools). A model that cannot call tools will talk about the story without building it. Smaller models also run out of room in a long conversation sooner; **New chat** clears it.

A local thinking model, such as one of the `qwen3` or `r1` family, writes its thinking into the reply between `<think>` tags rather than sending it separately. The panel pulls that back out and shows it in the same folded block the hosted providers use, so the reply reads the same either way.

Settings are stored in `ai-settings.json` inside the app's `userData` folder, which survives updates. **API keys are written there in plain text**, so treat that file the way you would treat the keys themselves.

### Logs

Everything the app does is written to a plain text file: startup, the window, every message sent, every tool call and how long it took, every error, and what was installed. One file per day, in a **`Logs`** folder beside the app itself:

```
%LOCALAPPDATA%\ScratchJR-AI-Assisted\Logs\9-23-2026_Log.txt
```

Lines read:

```
[ 9-23-2026 08:58:24 ] [ INFO ] - Starting the MCP tool server {"node":"node.exe","server":"...\mcp\src\server.js"}
[ 9-23-2026 08:58:28 ] [ INFO ] - Tool call finished {"tool":"scratchjr_status","ms":3225,"isError":false}
[ 9-23-2026 08:59:02 ] [ WARN ] - No usable Node.js found {"needs":22}
```

Status is `INFO`, `WARN` or `ERROR`. The folder sits next to the app rather than inside the versioned folder, so an update does not take the logs with it; if that folder cannot be written - an install somewhere locked down - the app falls back to a `Logs` folder in its `userData` directory instead of failing. **The API key is never written**, in any line, including inside error text. Logs older than 30 days are deleted at startup.

### When something is missing

The assistant needs Node.js 22 or newer for its tool server. If there is none, or the one installed is too old, the app asks before doing anything about it:

> **Something is missing** - The assistant needs Node.js to run the ScratchJr tools, and it is not installed on this computer.
> Install a copy for this app only? **[ Install now ] [ Not now ]**

**Not now** installs nothing and says so in the panel; the question comes back next time a message is sent. **Install now** downloads about 36 MB into the app's own folder, which needs no administrator rights and leaves any other Node.js alone.

If the tool server itself cannot be found, the app says which setting points at it rather than failing halfway through a story.

### Cost and the round limit

Every message is a paid request on your own account, and a single story usually costs several requests because the assistant calls tools and reads the results. **Tool rounds per message** under Advanced caps how many times it may do that before it has to stop and report back. Twelve suits most stories; lower it to spend less, raise it for longer builds.

### Node.js installs itself

The assistant runs the tool server with Node 22 or newer. You do not have to install it: the first time you send a message, the app checks for a suitable Node and, finding none, downloads one.

It takes the portable zip rather than the official installer, and unpacks it into the app's own folder under `userData`. That means no administrator rights, no UAC prompt, no change to the machine's `PATH`, and no interference with any Node already installed for other work. Uninstalling the app removes it too. The download is about 36 MB and happens once.

A Node that is already installed and new enough is used as it is and never replaced. One that is too old is left alone as well; the app fetches its own copy alongside it.

**Advanced > Node.js path** shows which Node will be used and offers an **Install now** button to do the download before you need it. Leave the box blank to keep detecting automatically, or point it at a specific `node.exe`.

The editor itself works without Node; only the assistant needs it.

### What the panel shows

Replies stream in as they are written, so there is something to watch from the first second rather than a blank panel until the whole answer lands. While a message is running, a strip under the heading says what is happening now - waiting for the model, thinking, writing the reply, or which tool is running - with the seconds counted and the round out of the tool budget.

A thinking model's working arrives in a folded **Thinking** block, which closes itself once the answer starts.

Each tool call appears as a collapsible row with how long it took: click it to see the arguments and the result the model received. Screenshots taken by `scratchjr_screenshot` are shown inline. A failed call opens itself and is marked in red, so a wrong turn is visible rather than buried.

**New chat** clears the conversation and starts the model fresh. **Stop** interrupts a run that is going nowhere; it takes effect after the tool call in flight finishes.

### Attaching a document

The paperclip beside the message box takes a **`.md`**, **`.txt`** or **`.pdf`** file, and files can be dropped onto the panel instead. A PDF's text is pulled out on this machine; nothing is uploaded and nothing is sent anywhere until the message it is attached to is sent.

Each attached file shows as a chip with how much text it holds and an x to take it off again. A document longer than 20,000 characters is cut there, and both the panel and the model are told it was cut, so a long plan costs a bounded amount. Attachments go with one message: after that they are part of the conversation and do not need attaching again.

Only those three kinds are accepted. Anything else, including a scanned PDF with no text layer, is refused with a line saying why.

## About

**File > About** lists the credits:

- [jfo8000](https://github.com/jfo8000/ScratchJr-Desktop) — ported version of ScratchJr
- [SkieAdminYT](https://github.com/SkieAdmin) — MCP and AI integration
- [MIT Media Lab](https://www.scratchjr.org) — original ScratchJr

## Installation Setup:

There are two ways to install. Both finish with the same MCP registration, so the client sections further down apply either way.

| Path | What you get | When to use it |
| --- | --- | --- |
| **One-click** | Builds and installs `Scratch.JR [ AI-Assisted ] v1.0.2` from `desktop/`, then registers the MCP server | The normal choice. The app opens the MCP connection by itself, so nothing has to be closed and reopened |
| **Manual** | Uses a stock ScratchJr Desktop download and sets the server up step by step | You want the unmodified app, or the one-click build failed and you are working through it |

Paths in this document are for this PC, where the project lives at `C:\Users\SkieHackerYT\Documents\Gitlab\ScratchJR-MCP`. On another machine, replace that folder and the Windows account name throughout.

### One-click install

Double-click `install.cmd` in the project folder, or run:

```powershell
Set-Location 'C:\Users\SkieHackerYT\Documents\Gitlab\ScratchJR-MCP'
npm.cmd run one-click
```

It runs these steps in order and stops at the first failure with a message naming the step:

1. Installs this server's dependencies.
2. Installs the desktop app's dependencies in `desktop\` — around 900 packages, and the slowest step.
3. Downloads the Electron 1.8.2 runtime. npm 11 defers that package's install script, so it is fetched explicitly.
4. Builds `desktop\out\make\squirrel.windows\x64\Scratch.JR [ AI-Assisted ]-1.0.2 Setup.exe`.
5. Runs that installer, which installs to `%LOCALAPPDATA%\ScratchJR-AI-Assisted\app-1.0.2\` and starts the app.
6. Registers the server with Claude Desktop, Claude Code, and Codex.

Expect fifteen to twenty minutes the first time, most of it in steps 2 and 4. Windows SmartScreen may warn about the installer: it is unsigned because it is built on your machine rather than downloaded from a signed release.

Afterwards, restart Claude and start a new Codex session. Cursor and Antigravity still need the manual configuration in sections 5 and 6.

To repeat a single stage instead of the whole run:

```powershell
npm.cmd run app:install   # desktop app dependencies only
npm.cmd run app:make      # build the installer only
npm.cmd run app:start     # run the app from source without installing it
npm.cmd run setup         # client registration only
```

### 1. Install and initialize ScratchJr Desktop

Skip this if you used the one-click install, which already put an app in place.

1. Open the [ScratchJr Desktop download page](https://jfo8000.github.io/ScratchJr-Desktop/) and select the Windows installer. This is the community desktop port.
2. Run the installer, then launch ScratchJr Desktop.
3. Create a small project, return to the project library to save it, and close ScratchJr.
4. Confirm the database exists at `C:\Users\SkieHackerYT\Documents\ScratchJR\scratchjr.sqllite`. On another PC, replace `SkieHackerYT` with that Windows account's name. The desktop port stores its projects in this Documents folder. See the [desktop project's storage documentation](https://jfo8000.github.io/ScratchJr-Desktop/#wheres-the-data).

The server looks for the modified build first, at `%LOCALAPPDATA%\ScratchJR-AI-Assisted\app-*\ScratchJr.exe`, and falls back to a stock install at `%LOCALAPPDATA%\ScratchJr\app-*\ScratchJr.exe`. Both can be installed at the same time. For a custom installation or a redirected Documents folder, set `SCRATCHJR_EXE` or `SCRATCHJR_DATABASE` as described below.

Both builds read and write the same `scratchjr.sqllite`. Run only one of them at a time: each holds the database in memory and writes its copy back when it closes, so whichever closes last overwrites the other's work.

### 2. Prepare the local assets folder

Use this folder to organize custom source artwork:

```text
C:\Users\SkieHackerYT\Documents\ScratchJr\_Assets
```

Create it if it does not already exist:

```powershell
New-Item -ItemType Directory -Path 'C:\Users\SkieHackerYT\Documents\ScratchJr\_Assets' -Force
```

Keep custom SVG characters and backgrounds here. This is a source-artwork folder: the MCP server does **not** automatically scan or import its files. To use an SVG, read it using the AI client's file-access tools, or paste its contents into the chat, and ask the assistant to register it with `scratchjr_add_svg_asset`. That tool accepts SVG markup, a name, a kind (`character` or `background`), width, and height. Use static SVG geometry; backgrounds should be 480 by 360 pixels. Use the returned `md5` filename when creating a character or choosing a background.

Registered artwork is saved inside ScratchJr's database and can be discovered with `scratchjr_list_assets`. Simply placing PNG, JPG, audio, or SVG files in `_Assets` does not make them available to ScratchJr.

### 3. Install the MCP server dependencies

Install Node.js 22 or newer with npm, then open PowerShell and verify both commands:

```powershell
node --version
npm.cmd --version
```

Open this project's folder and install the locked dependencies:

```powershell
Set-Location 'C:\Users\SkieHackerYT\Documents\Gitlab\ScratchJR-MCP'
npm.cmd ci
```

### 4. Register the server with Claude Desktop, Claude Code, and Codex

From the same project folder, run:

```powershell
npm.cmd run setup
```

Setup writes the `scratchjr` entry into Claude Desktop's configuration file and registers a user-level server with Claude Code and Codex through their CLIs. Every file it touches is backed up next to the original first. It is safe to run repeatedly: an entry that already points at this folder is left alone.

If a `scratchjr` entry exists but points somewhere else — most often because the project was moved, leaving the old path holding some other server — setup replaces it and prints the path it replaced. This is worth knowing, because a stale entry shows up as a connection error rather than as a missing server, which is easy to misread as the tools themselves being broken.

| Client | Where the entry goes | How to verify |
| --- | --- | --- |
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` | Fully quit and reopen Claude Desktop, then look for `scratchjr` under the tools icon |
| Claude Code | User scope, in `%USERPROFILE%\.claude.json` | `claude.cmd mcp get scratchjr`, then start a new session |
| Codex | `%USERPROFILE%\.codex\config.toml` | `codex mcp get scratchjr --json`, then start a new session |

Setup also writes ready-made snippets into `config/`:

- [config/claude-desktop.json](config/claude-desktop.json) — the `mcpServers` entry, which suits Cursor and Antigravity as well.
- [config/codex.toml](config/codex.toml) — the `[mcp_servers.scratchjr]` section, including the timeouts.

**If the Codex CLI is not installed,** setup cannot reach Codex and says so. Open `%USERPROFILE%\.codex\config.toml`, replace any existing `[mcp_servers.scratchjr]` section with the contents of `config/codex.toml`, and leave every other section as it is:

```toml
[mcp_servers.scratchjr]
command = "C:\\Program Files\\nodejs\\node.exe"
args = ["C:\\Users\\SkieHackerYT\\Documents\\Gitlab\\ScratchJR-MCP\\src\\server.js"]
startup_timeout_sec = 30
tool_timeout_sec = 120
```

The timeouts matter. Building a project and taking a screenshot can take longer than Codex's default tool timeout allows.

The same applies to the Claude Code CLI. Without it, Claude Desktop is still configured, and Claude Code can be registered by hand:

```powershell
claude.cmd mcp add --scope user scratchjr -- 'C:\Program Files\nodejs\node.exe' 'C:\Users\SkieHackerYT\Documents\Gitlab\ScratchJR-MCP\src\server.js'
```

Keep the project folder where it is after registering. Moving it breaks every entry, and setup has to be run again from the new location.

### 5. Add the server to Cursor

Complete steps 1–3 first. `npm.cmd run setup` configures Claude and Codex; **Cursor and Antigravity require the manual configuration below**.

1. Open your project in Cursor.
2. Create or open one of these configuration files. Choose the global file to use ScratchJr across all projects, or the project file for this workspace only.

| Scope | Configuration file on this PC |
| --- | --- |
| Global | `C:\Users\SkieHackerYT\.cursor\mcp.json` |
| Project | `C:\Users\SkieHackerYT\Documents\Gitlab\ScratchJR-MCP\.cursor\mcp.json` |

3. Add the configuration below. If the file already contains servers, merge only the `scratchjr` entry into its existing `mcpServers` object.

```json
{
  "mcpServers": {
    "scratchjr": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": [
        "C:\\Users\\SkieHackerYT\\Documents\\Gitlab\\ScratchJR-MCP\\src\\server.js"
      ]
    }
  }
}
```

4. Save the file and restart Cursor. Open **Customize > MCPs** and enable `scratchjr` if needed.
5. Start an Agent chat and ask it to call `scratchjr_connect`, then `scratchjr_list_projects`.

Cursor supports both configuration locations; a project entry takes precedence over a global entry with the same name. See the [official Cursor MCP instructions](https://cursor.com/help/customization/mcp).

The JSON uses this PC's paths. On another machine, adjust the Node executable and the server path. Keep the doubled backslashes required by JSON. You can also copy this entry from [config/claude-desktop.json](config/claude-desktop.json), which setup regenerates with the current path on every run.

### 6. Add the server to Google Antigravity

1. Open Antigravity IDE and its Agent side panel.
2. Click **… > MCP Servers > Manage MCP Servers > View raw config**.
3. In the opened `mcp_config.json`, merge the same `scratchjr` configuration shown above into `mcpServers`. Preserve any other server entries.
4. Save the file, then refresh the MCP server list or restart Antigravity. Ensure `scratchjr` is enabled.
5. Start a new Agent conversation and ask it to call `scratchjr_connect`, then `scratchjr_list_projects`.

Current Antigravity documentation lists these configuration locations:

| Scope | Configuration file on this PC |
| --- | --- |
| Global | `C:\Users\SkieHackerYT\.gemini\config\mcp_config.json` |
| Workspace | `C:\Users\SkieHackerYT\Documents\Gitlab\ScratchJR-MCP\.agents\mcp_config.json` |

Prefer the file opened by **View raw config** for your installed IDE version. Antigravity 2.0 exposes server management under **Settings > Customizations > Installed MCP Servers**. See the [official Antigravity MCP instructions](https://antigravity.google/docs/mcp).

Both editors launch `src/server.js` directly using Node and stdio. No MCP URL or separate `npm start` terminal is needed. Port `9223` is the app's internal debugging connection, not an HTTP MCP endpoint.

### 7. Verify the ScratchJr connection

Run the built-in check from the project folder:

```powershell
npm.cmd run doctor
```

It reports the executable and database the server chose, along with the projects ScratchJr currently holds. With the modified build this works against a window that is already open. If nothing is running, use `npm.cmd run doctor -- --launch` to start the app first. With a stock install, save and close any ScratchJr window opened from its ordinary shortcut before using `--launch`.

A healthy result names the executable and lists your projects:

```json
{
  "config": {
    "executable": "C:\\Users\\SkieHackerYT\\AppData\\Local\\ScratchJR-AI-Assisted\\app-1.0.2\\ScratchJr.exe",
    "database": "C:\\Users\\SkieHackerYT\\Documents\\ScratchJR\\scratchjr.sqllite"
  },
  "app": { "ready": true, "projects": [ { "ID": 1, "NAME": "Project 1" } ] }
}
```

Then, in any registered client, try:

> Use the scratchjr tools to create a dancing dog in a park. Build the project, run it, inspect a screenshot, then stop, reset, and save it.

`scratchjr_status` reports which build answered, as `build` and `buildVersion`. That is the quickest way to tell the modified app from a stock one.

If the tools do not appear:

- Check that `scratchjr` is enabled in the client and that its JSON or TOML is valid.
- Confirm both absolute paths in the entry exist, especially after moving the project folder. Rerun `npm.cmd run setup` to repair them.
- Confirm `npm.cmd ci` completed in the server folder, then restart the client and start a new Agent chat.
- In Cursor, connection details are under **Output > MCP Logs**; in Antigravity, inspect the server entry in **Manage MCP Servers**.
- Follow the client's tool-approval prompts when shown.

## Procedure:

1. Open Claude Desktop, Claude Code, Codex, Cursor, or Antigravity and start a new Agent conversation after registration.
2. Ask the assistant to call `scratchjr_connect` and check `scratchjr_status`.
3. Describe the story, animation, or game you want. Include characters, scenes, dialogue, and what should happen when a character is clicked.
4. Have the assistant inspect available assets and blocks, create the project, run it, and check a screenshot. For custom artwork, register the SVG from `_Assets` before using it in the project.
5. Test the project in ScratchJr using the green flag and character clicks.
6. Ask for any changes, then stop/reset and save the project. It remains available in ScratchJr's project library.

Example request:

> Use ScratchJr to create an interactive ocean adventure with three characters and two scenes. Make the characters talk and move when clicked. Build it, run it, check a screenshot, and save it.

Example custom-artwork request, after providing the SVG contents or granting the client access to the file:

> Register my star SVG from C:\Users\SkieHackerYT\Documents\ScratchJr\_Assets as a character. Create a space scene where clicking the star makes it spin. Test and save it.

On this PC, **MCP Demo - Park Friends (Ready)** is already in the ScratchJr library. Press the green flag to animate Tic and the dog. Click the dog to visit the stars; click the star to return. To edit it, try:

> Open MCP Demo - Park Friends (Ready). Make the dog hop three times when I click it, then switch to the space scene. Test and save the changes.

### Connection behavior

The configured MCP client starts `src/server.js` using MCP's standard stdio transport. No API keys or model subscriptions are embedded in the server; the connected assistant interprets your request and calls the tools.

The first application tool connects to ScratchJr on **127.0.0.1:9223**, or automatically launches the installed app with that local debugging port. It does not modify the installed application.

If ScratchJr is already running from its ordinary shortcut without the connection enabled, save your work and close it once. Then ask the assistant to connect again. The server does not force-close an existing editor session. You can normally leave the connected app open while using either client. Avoid simultaneous manual edits while an assistant is changing a project.

With the build in `desktop/`, that close-and-reopen step is not needed: the app opens the connection itself as it starts, so the server attaches to a window that is already on screen.

A freshly started ScratchJr sits on the splash screen, which waits for a child to press Start and has none of the project code loaded yet. Connecting moves the app to its project library so the first tool call succeeds. If a child is looking at the splash screen when an assistant connects, that is why the screen changes.

### Tool reference

| Tool | Action |
| --- | --- |
| `scratchjr_connect` / `scratchjr_status` | Connect, launch, or inspect connection status |
| `scratchjr_list_assets` | Discover installed characters, backgrounds, and sounds |
| `scratchjr_block_reference` | Read block names, allowed arguments, and units |
| `scratchjr_list_projects` / `scratchjr_get_project` | Find projects and inspect their actual data |
| `scratchjr_create_project` | Build a complete project with pages, characters, text, and scripts |
| `scratchjr_edit_project` | Batch edits while preserving unrelated objects |
| `scratchjr_open_project` / `scratchjr_save_project` | Open and persist projects |
| `scratchjr_run_project` / `scratchjr_stop_project` | Start green-flag scripts, stop, or reset |
| `scratchjr_click_character` | Exercise click interactions |
| `scratchjr_add_svg_asset` | Create a custom character or background from static SVG geometry |
| `scratchjr_screenshot` | Return an actual editor screenshot to the assistant |
| `scratchjr_backup` / `scratchjr_export_project` | Back up the database or export project JSON and media |

Also includes the `scratchjr://guide` resource and `create-scratchjr-project` prompt.

ScratchJr supports up to four pages, motion, speech, sounds, repeat loops, click/collision events, colored messages, and page transitions. It does not support Scratch 3 features such as variables, keyboard controls, scores, or arithmetic. The assistant should implement your idea using those available blocks and explain any remaining limitations.

### Development checks

```powershell
npm.cmd test                 # Six automated model/protocol tests; does not launch the app
npm.cmd run doctor          # Inspect connection and list projects
npm.cmd run doctor -- --launch
npm.cmd run test:live        # Creates a new demo in the real ScratchJr library
npm.cmd run test:extended    # Adds a custom star and second page to the latest test demo
```

`npm start` runs the MCP protocol server and waits for client input; it is not a web page. Clients use the absolute Node executable and server path, so their current directory does not matter.

### Optional environment settings

| Variable | Default |
| --- | --- |
| `SCRATCHJR_EXE` | Auto-detected versioned ScratchJr executable |
| `SCRATCHJR_DEBUG_PORT` | `9223` |
| `SCRATCHJR_DATABASE` | `~/Documents/ScratchJR/scratchjr.sqllite` |
| `SCRATCHJR_BACKUP_DIR` | This server's `backups/` folder |
| `SCRATCHJR_OUTPUT_DIR` | This server's `artifacts/` folder |

The modified desktop app in `desktop/` reads two more, which only affect the app itself:

| Variable | Effect |
| --- | --- |
| `SCRATCHJR_DEBUG_PORT` | Port the app opens for the MCP connection. Set it to `0` to start the app with no MCP listener at all |
| `SCRATCHJR_DOCUMENTS` | Overrides the Documents root the app reads and writes. Useful for trying a build without touching real projects |
| `SCRATCHJR_DEVTOOLS` | Set to `1` to open DevTools in a source run. DevTools takes the single debugger slot, so the MCP server cannot attach while it is open |

If you customize settings, use the same values in every client. In the Cursor and Antigravity JSON, place environment settings in an `env` object alongside `command` and `args` within the `scratchjr` entry. If Windows Documents is redirected, set `SCRATCHJR_DATABASE` to the app's actual database path.

### Project input

`examples/park-friends.json` is a complete `scratchjr_create_project` argument. Character `asset` and page `background` values must be exact filenames returned by `scratchjr_list_assets`.

Coordinates use a 480×360 stage with the origin at the top left. One motion step is 24 pixels. `wait: 10` means one second. `right` and `left` rotate; `forward` and `back` move horizontally. Each script is an array of `{op, value?, body?}` objects; a `repeat` block holds its enclosed blocks in `body`.

To change existing work, call `get_project`, then `edit_project` with its `revision`, page/object IDs, and a batch of operations. `set_scripts` changes only code. `set_character` replaces that entire character's configuration. The server rejects a stale revision so two assistants do not silently overwrite one another's changes.

### Persistence and recovery

Project writes use the running application's in-memory database, then explicitly flush to disk. Creating, editing, and adding artwork make timestamped full database backups first. Cross-process locking serializes tool operations between Claude and Codex. There is no arbitrary JavaScript or SQL execution tool.

`backups/` contains complete `.sqllite` snapshots. To restore manually, save and close ScratchJr, preserve a copy of the current database, replace `Documents\ScratchJR\scratchjr.sqllite` with the selected snapshot, and reopen ScratchJr. Restoring a full database restores all projects to that snapshot's state.

`artifacts/` contains screenshots, JSON exports, and `live-test-result.json`. The JSON export includes referenced custom media and is intended for inspection/backup; it is **not** a tablet-importable `.sjr` archive; for that, use **File > Save Project to Computer** in the bundled app. Automated import and recorded-audio creation are not implemented. Existing recorded sounds can be used in scripts.

Tested against **ScratchJr Desktop 1.3.2 on Windows**, Node 24, MCP SDK 1.30.0, the installed Codex CLI, and Claude Code. Claude Desktop's configuration is installed, but its UI was not used for testing. Cursor and Antigravity instructions follow their official MCP documentation; connections from those editors have not been tested here. Other desktop builds may need an adapter.

Verification completed on this PC: stdio handshake and tool/resource/prompt discovery; native project creation; visible rendering; measured movement after green-flag execution; edits and stale-revision rejection; custom SVG rendering; click-driven navigation between two pages; screenshots; disk persistence; and SQLite integrity. Original Project 1 was compared with the pre-test backup and was unchanged.

Implementation references: [ScratchJr Desktop source](https://github.com/jfo8000/ScratchJr-Desktop/), [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/), and [Claude Desktop MCP configuration](https://github.com/modelcontextprotocol/docs/blob/main/quickstart/user.mdx). Codex and Claude Code registration use their installed CLI commands. This is an independent integration, not an official ScratchJr release.

**Created by: Kerneil Rommel S. Gocotano**
