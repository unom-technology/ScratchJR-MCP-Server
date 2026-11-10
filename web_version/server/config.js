import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Settings already in the environment win over .env, so a one-off
// `PORT=8080 npm start` works without editing the file.
const envFile = join(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
// Relative to prisma/schema.prisma, as Prisma resolves it.
process.env.DATABASE_URL ||= 'file:../data/scratchjr-web.db';

const fromRoot = value => (value ? resolve(root, value) : null);

export const config = {
  port: Number(process.env.PORT || 80),
  host: process.env.HOST || '0.0.0.0',
  sessionHours: Number(process.env.SESSION_HOURS || 12),
  httpsCert: fromRoot(process.env.HTTPS_CERT),
  httpsKey: fromRoot(process.env.HTTPS_KEY),
  // The ScratchJr app, built from ../desktop/src/app by `npm run build`.
  appDir: join(root, 'public', 'app'),
  // The login page.
  staticDir: join(root, 'static'),
};

if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error(`PORT must be a port number, not "${process.env.PORT}".`);
if (!(config.sessionHours > 0)) throw new Error('SESSION_HOURS must be a positive number of hours.');
if (Boolean(config.httpsCert) !== Boolean(config.httpsKey)) throw new Error('Set both HTTPS_CERT and HTTPS_KEY, or neither.');
