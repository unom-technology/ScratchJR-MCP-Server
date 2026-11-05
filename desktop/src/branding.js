//
//  branding.js - identity of this modified build.
//
//  Everything user-visible about the fork's name lives here so a rename is a
//  one-file change. Upstream ScratchJr Desktop has no equivalent file.
//
//  Note: productName may contain spaces and punctuation, installerName may not.
//  Squirrel treats installerName as a NuGet package id, which allows only
//  letters, digits, dot, dash and underscore, and it also decides the install
//  directory: %LOCALAPPDATA%\<installerName>\app-<version>\<exeName>

const productName = 'Scratch.JR [ AI-Assisted ]';
const version = '1.0.4';

module.exports = {
  productName: productName,
  version: version,
  // No dots: Squirrel truncates the install directory at the first one, which
  // would put the app in %LOCALAPPDATA%\Scratch.
  installerName: 'ScratchJR-AI-Assisted',
  exeName: 'ScratchJr.exe',
  windowTitle: productName + ' v' + version,

  credits: [
    {name: 'jfo8000', url: 'https://github.com/jfo8000/ScratchJr-Desktop', role: 'Ported version of ScratchJr'},
    {name: 'SkieAdminYT', url: 'https://github.com/SkieAdmin', role: 'MCP and AI integration'},
    {name: 'MIT Media Lab', url: 'https://www.scratchjr.org', role: 'Original ScratchJr'}
  ],

  // Chrome DevTools Protocol port the MCP server attaches to.
  // Set SCRATCHJR_DEBUG_PORT=0 to start without the MCP listener.
  mcpDebugPort: Number(process.env.SCRATCHJR_DEBUG_PORT === undefined ? 9223 : process.env.SCRATCHJR_DEBUG_PORT),
};
