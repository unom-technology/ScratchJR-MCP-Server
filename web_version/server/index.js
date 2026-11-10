import { readFileSync, existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import http from 'node:http';
import https from 'node:https';
import { config } from './config.js';
import { createApp } from './app.js';

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const app = createApp({prisma, config});

const server = config.httpsCert
  ? https.createServer({cert: readFileSync(config.httpsCert), key: readFileSync(config.httpsKey)}, app)
  : http.createServer(app);

server.on('error', error => {
  if (error.code === 'EADDRINUSE') console.error(`Port ${config.port} is already in use by another program. Set PORT in .env to a free port, such as 8080.`);
  else if (error.code === 'EACCES') console.error(`This computer does not allow programs to use port ${config.port}. Set PORT in .env to 8080, or run as administrator.`);
  else console.error(error);
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  const scheme = config.httpsCert ? 'https' : 'http';
  const port = (scheme === 'http' && config.port === 80) || (scheme === 'https' && config.port === 443) ? '' : `:${config.port}`;
  const addresses = Object.values(networkInterfaces()).flat()
    .filter(a => a && a.family === 'IPv4' && !a.internal)
    .map(a => `${scheme}://${a.address}${port}/`);

  console.log('ScratchJr Web is running.');
  if (config.host === '0.0.0.0' && addresses.length) {
    console.log('Students open one of these addresses:');
    for (const address of addresses) console.log(`  ${address}`);
  }
  console.log(`On this computer: ${scheme}://localhost${port}/`);
  if (!existsSync(config.appDir)) console.log('The app has not been built yet. Stop the server and run: npm run build');
  if (!config.httpsCert) console.log('Recording sounds and the camera need HTTPS; see README.md.');
});

async function stop() {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
