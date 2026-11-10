import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

export const COOKIE = 'sjr_session';

// Lower-case letters, digits and . _ - so a name is easy to type on any
// keyboard and cannot be confused with another that differs only in case.
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,23}$/;
const MIN_PASSWORD = 4;
const MAX_PASSWORD = 200;

export function normalizeUsername(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function usernameProblem(username) {
  if (USERNAME.test(username)) return null;
  return 'Usernames are 3 to 24 letters or numbers (you can also use . _ -), starting with a letter or number.';
}

export function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) return `Passwords need at least ${MIN_PASSWORD} characters.`;
  if (password.length > MAX_PASSWORD) return 'That password is too long.';
  return null;
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, salt, expected] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !expected) return false;
  const wanted = Buffer.from(expected, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), wanted.length);
  return timingSafeEqual(key, wanted);
}

// The cookie carries a random token; only its hash is stored, so a copy of the
// database cannot be used to log in as anyone.
export function newToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

export function sessionCookie(token, {hours, secure}) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.round(hours * 3600)}${secure ? '; Secure' : ''}`;
}

export function clearedCookie({secure}) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

// Slows down guessing a classmate's password. Counted per address and name,
// so one student's typos never lock out the rest of the room.
export class LoginLimiter {
  constructor({attempts = 8, minutes = 10} = {}) {
    this.attempts = attempts;
    this.windowMs = minutes * 60 * 1000;
    this.failures = new Map();
  }

  key(ip, username) {
    return `${ip}|${username}`;
  }

  blocked(ip, username) {
    const entry = this.failures.get(this.key(ip, username));
    if (!entry) return false;
    if (Date.now() - entry.first > this.windowMs) {
      this.failures.delete(this.key(ip, username));
      return false;
    }
    return entry.count >= this.attempts;
  }

  failed(ip, username) {
    const key = this.key(ip, username);
    const entry = this.failures.get(key);
    if (!entry || Date.now() - entry.first > this.windowMs) this.failures.set(key, {count: 1, first: Date.now()});
    else entry.count++;
  }

  succeeded(ip, username) {
    this.failures.delete(this.key(ip, username));
  }
}
