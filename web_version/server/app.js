import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  COOKIE, LoginLimiter, normalizeUsername, usernameProblem, passwordProblem, hashPassword, verifyPassword,
  newToken, hashToken, readCookie, sessionCookie, clearedCookie,
} from './auth.js';
import { Store, BadRequest } from './store.js';
import { MAX_FILE_CHARS } from './tables.js';

// A scrypt hash of a random password, checked when the username does not
// exist, so a wrong name takes as long to refuse as a wrong password.
const NO_SUCH_USER = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

export function createApp({prisma, config}) {
  const store = new Store(prisma);
  const limiter = new LoginLimiter();
  const secure = Boolean(config.httpsCert);
  const cookieOptions = {hours: config.sessionHours, secure};

  const app = express();
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    res.set('X-Frame-Options', 'SAMEORIGIN');
    next();
  });

  async function currentUser(req) {
    const token = readCookie(req.headers.cookie, COOKIE);
    if (!token) return null;
    const session = await prisma.session.findUnique({where: {id: hashToken(token)}, include: {user: true}});
    if (!session) return null;
    if (session.expiresAt < new Date()) {
      await prisma.session.deleteMany({where: {id: session.id}});
      return null;
    }
    return session.user;
  }

  async function startSession(res, user) {
    const token = newToken();
    const expiresAt = new Date(Date.now() + config.sessionHours * 3600 * 1000);
    await prisma.session.create({data: {id: hashToken(token), userId: user.id, expiresAt}});
    // Expired sessions are tidied up here rather than on a timer.
    await prisma.session.deleteMany({where: {expiresAt: {lt: new Date()}}});
    res.set('Set-Cookie', sessionCookie(token, cookieOptions));
  }

  const api = express.Router();
  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    // SameSite=Lax already keeps the cookie off cross-site posts; this also
    // refuses a write whose Origin names another site.
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin) {
      let host = null;
      try { host = new URL(req.headers.origin).host; } catch { /* not a URL */ }
      if (host !== req.headers.host) return res.status(403).json({error: 'Requests from other sites are not allowed.'});
    }
    next();
  });
  api.use(express.json({limit: Math.ceil(MAX_FILE_CHARS * 1.2)}));

  const requireUser = async (req, res, next) => {
    req.user = await currentUser(req);
    if (!req.user) return res.status(401).json({error: 'Please log in.'});
    next();
  };

  api.post('/register', async (req, res) => {
    const username = normalizeUsername(req.body?.username);
    const password = req.body?.password;
    const problem = usernameProblem(username) || passwordProblem(password);
    if (problem) return res.status(400).json({error: problem});
    if (await prisma.user.findUnique({where: {username}})) return res.status(409).json({error: 'That username is taken. Try another one, or log in.'});
    let user;
    try {
      user = await prisma.user.create({data: {username, passwordHash: await hashPassword(password), lastLoginAt: new Date()}});
    } catch (error) {
      // Two students registering the same name at the same moment.
      if (error.code === 'P2002') return res.status(409).json({error: 'That username is taken. Try another one, or log in.'});
      throw error;
    }
    await startSession(res, user);
    res.status(201).json({username: user.username});
  });

  api.post('/login', async (req, res) => {
    const username = normalizeUsername(req.body?.username);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (limiter.blocked(req.ip, username)) return res.status(429).json({error: 'Too many wrong tries. Wait a few minutes, or ask your teacher.'});
    const user = username ? await prisma.user.findUnique({where: {username}}) : null;
    const ok = await verifyPassword(password, user ? user.passwordHash : NO_SUCH_USER);
    if (!user || !ok) {
      limiter.failed(req.ip, username);
      return res.status(401).json({error: 'That username and password don\'t match.'});
    }
    limiter.succeeded(req.ip, username);
    await prisma.user.update({where: {id: user.id}, data: {lastLoginAt: new Date()}});
    await startSession(res, user);
    res.json({username: user.username});
  });

  api.post('/logout', async (req, res) => {
    const token = readCookie(req.headers.cookie, COOKIE);
    if (token) await prisma.session.deleteMany({where: {id: hashToken(token)}});
    res.set('Set-Cookie', clearedCookie(cookieOptions));
    res.json({ok: true});
  });

  api.get('/me', requireUser, (req, res) => {
    res.json({id: req.user.id, username: req.user.username});
  });

  api.get('/state', requireUser, async (req, res) => {
    res.json({user: {id: req.user.id, username: req.user.username}, ...await store.state(req.user.id)});
  });

  api.post('/sync', requireUser, async (req, res) => {
    res.json(await store.sync(req.user.id, req.body || {}));
  });

  api.get('/files/:name', requireUser, async (req, res) => {
    const contents = await store.file(req.user.id, req.params.name);
    if (contents === null) return res.status(404).json({error: 'No such file.'});
    res.type('text/plain').send(contents);
  });

  api.post('/files/clean', requireUser, async (req, res) => {
    res.json(await store.clean(req.user.id, req.body?.type));
  });

  api.use((req, res) => res.status(404).json({error: 'No such API.'}));

  app.use('/api', api);

  app.get('/', async (req, res) => {
    res.redirect((await currentUser(req)) ? '/app/home.html' : '/login');
  });
  app.get('/login', (req, res) => res.sendFile(join(config.staticDir, 'login.html')));
  app.get('/favicon.ico', (req, res) => {
    const icon = join(config.appDir, 'favicon.ico');
    if (existsSync(icon)) res.sendFile(icon);
    else res.status(204).end();
  });
  app.use('/static', express.static(config.staticDir, {index: false}));

  if (existsSync(config.appDir)) {
    app.use('/app', express.static(config.appDir, {
      index: false,
      setHeaders(res, path) {
        // Pages always revalidate, so a rebuilt app reaches every student.
        if (path.endsWith('.html')) res.set('Cache-Control', 'no-cache');
      },
    }));
  } else {
    app.use('/app', (req, res) => res.status(503).type('text/plain').send('The ScratchJr app has not been built yet. On the server, run: npm run build'));
  }

  app.use((error, req, res, next) => { // eslint-disable-line no-unused-vars
    if (error instanceof BadRequest || error.type === 'entity.parse.failed') return res.status(400).json({error: error.message});
    if (error.type === 'entity.too.large') return res.status(413).json({error: 'That is too big to save.'});
    console.error(error);
    res.status(500).json({error: 'Something went wrong on the server.'});
  });

  return app;
}
