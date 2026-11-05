//
//  mcp.js - talks to the ScratchJr MCP server over stdio.
//
//  The server is the same one Claude Desktop and Codex use. Running it here
//  keeps a single implementation of every ScratchJr tool: this app starts it as
//  a child process, and it drives the editor back through the debugging port
//  the app already opens. The round trip looks odd on paper but it means the
//  assistant panel and an external editor behave identically.
//
//  It needs Node 22 or newer, which the app itself does not ship, so a missing
//  or ancient Node is reported as a plain sentence rather than a stack trace.

const {spawn} = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const log = require(path.join(__dirname, '..', 'log.js'));

const CALL_TIMEOUT_MS = 180000;

// Candidates in order: an explicit setting, the copy staged beside the app, then
// the repository layout used when running from source.
//
// These are anchored to __dirname rather than app.getAppPath(), which under
// electron-forge's dev runner points at Electron's own default_app.asar. The
// packaged app keeps its files unpacked under resources/app, so a spawned Node
// can read this path in both cases.
function resolveServerPath(configured) {
  const appRoot = path.join(__dirname, '..', '..');      // .../desktop
  const candidates = [];
  if (configured) candidates.push(configured);
  candidates.push(path.join(appRoot, 'mcp', 'src', 'server.js'));
  candidates.push(path.join(appRoot, '..', 'src', 'server.js'));
  for (const candidate of candidates) {
    try { if (fs.statSync(candidate).isFile()) return candidate; } catch (error) { /* try the next one */ }
  }
  return null;
}

class McpSession {
  constructor(settings, nodePath) {
    this.settings = settings;
    this.nodePath = nodePath || settings.nodePath || 'node';
    this.child = null;
    this.nextId = 0;
    this.pending = new Map();
    this.tools = [];
  }

  async start() {
    if (this.child) return this.tools;

    const serverPath = resolveServerPath(this.settings.mcpServerPath);
    if (!serverPath) {
      throw new Error('The ScratchJr MCP server was not found. Set its path to src/server.js in Settings.');
    }

    const nodePath = this.nodePath;
    const env = Object.assign({}, process.env);
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NODE_OPTIONS;

    log.info('Starting the MCP tool server', {node: nodePath, server: serverPath});
    this.child = spawn(nodePath, [serverPath], {
      cwd: path.dirname(path.dirname(serverPath)),
      env: env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.stderr = '';
    this.child.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk).slice(-4000); });

    this.child.on('error', error => {
      log.error('The MCP tool server could not be started', error);
      const reason = error.code === 'ENOENT'
        ? `Node.js was not found${nodePath === 'node' ? ' on PATH' : ` at ${nodePath}`}. Install Node 22 or newer, or set its path in Settings.`
        : error.message;
      this.fail(new Error(reason));
    });

    this.child.on('exit', code => {
      log.warn('The MCP tool server stopped', {exitCode: code, output: this.stderr.trim().slice(-400)});
      const detail = this.stderr ? ` Server output: ${this.stderr.trim().split('\n').pop()}` : '';
      this.fail(new Error(`The ScratchJr MCP server stopped (exit code ${code}).${detail}`));
      this.child = null;
    });

    readline.createInterface({input: this.child.stdout}).on('line', line => {
      if (!line.trim()) return;
      let message;
      try { message = JSON.parse(line); } catch (error) { return; }
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else entry.resolve(message.result);
    });

    await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {name: 'scratchjr-assistant', version: '1.0.4'}
    });
    this.notify('notifications/initialized');

    const listed = await this.send('tools/list', {});
    this.tools = listed.tools || [];
    return this.tools;
  }

  fail(error) {
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    this.pending.clear();
  }

  notify(method, params) {
    if (!this.child) return;
    this.child.stdin.write(JSON.stringify({jsonrpc: '2.0', method: method, params: params || {}}) + '\n');
  }

  send(method, params) {
    if (!this.child) return Promise.reject(new Error('The ScratchJr MCP server is not running.'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} took longer than ${Math.round(CALL_TIMEOUT_MS / 1000)} seconds.`));
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, {resolve, reject, timer});
      this.child.stdin.write(JSON.stringify({jsonrpc: '2.0', id: id, method: method, params: params}) + '\n');
    });
  }

  // Returns {text, images, isError}. A tool that fails is not thrown: the model
  // is told what went wrong so it can correct itself on the next round.
  async call(name, args) {
    let response;
    const started = Date.now();
    log.info('Tool call', {tool: name, arguments: args || {}});
    try {
      response = await this.send('tools/call', {name: name, arguments: args || {}});
    } catch (error) {
      log.error('Tool call failed', {tool: name, ms: Date.now() - started, reason: error.message});
      return {text: error.message, images: [], isError: true};
    }
    log.info('Tool call finished', {tool: name, ms: Date.now() - started, isError: Boolean(response.isError)});
    const content = response.content || [];
    return {
      text: content.filter(part => part.type === 'text').map(part => part.text).join('\n'),
      images: content.filter(part => part.type === 'image'),
      isError: Boolean(response.isError)
    };
  }

  // MCP advertises JSON Schema, which is what the chat completions API wants.
  toolDefinitions() {
    return this.tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description || '',
        parameters: tool.inputSchema || {type: 'object', properties: {}}
      }
    }));
  }

  stop() {
    if (!this.child) return;
    const child = this.child;
    this.child = null;
    this.fail(new Error('The ScratchJr MCP server was stopped.'));
    try { child.stdin.end(); } catch (error) { /* already gone */ }
    child.kill();
  }
}

module.exports = {McpSession, resolveServerPath};
