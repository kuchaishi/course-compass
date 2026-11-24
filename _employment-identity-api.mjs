import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const TTL_SECONDS = 8 * 3600;
const IDENTITY_ROUTES = new Set([
  '/api/register',
  '/api/login',
  '/api/session',
  '/api/logout',
  '/api/profile/delete',
]);

export function defaultIdentityDbPath() {
  const base = process.env.LOCALAPPDATA || join(homedir(), '.local', 'share');
  return join(base, 'CourseCompass', 'identity.sqlite3');
}

function digestToken(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function deriveVerifier(password, salt) {
  return scryptSync(Buffer.from(password, 'utf8'), salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
}

function isLoopbackAddress(addr) {
  const clean = String(addr || '').replace(/^::ffff:/, '').toLowerCase();
  return clean === '127.0.0.1' || clean === '::1';
}

function isLoopbackHostHeader(hostHeader) {
  const raw = String(hostHeader || '').trim().toLowerCase();
  if (!raw) return false;
  const hostOnly = raw.startsWith('[')
    ? raw.slice(0, raw.indexOf(']') + 1)
    : raw.split(':')[0];
  return hostOnly === '127.0.0.1' || hostOnly === 'localhost' || hostOnly === '[::1]';
}

async function readIdentityJson(request, maxBytes = 4096) {
  const ct = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (ct !== 'application/json') {
    request.resume();
    return { ok: false, status: 400, error: '请求格式无效。' };
  }
  let size = 0;
  const chunks = [];
  try {
    for await (const piece of request.iterator({ destroyOnReturn: false })) {
      size += piece.length;
      if (size > maxBytes) {
        request.resume();
        return { ok: false, status: 400, error: '请求格式无效。' };
      }
      chunks.push(piece);
    }
    if (size === 0) return { ok: false, status: 400, error: '请求格式无效。' };
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, status: 400, error: '请求格式无效。' };
    }
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, status: 400, error: '请求格式无效。' };
  }
}

export function createLocalIdentityHandler({ dbPath = ':memory:' } = {}) {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  }
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users(
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE,
      salt BLOB,
      verifier BLOB,
      key TEXT,
      generation TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions(
      digest TEXT PRIMARY KEY,
      uid TEXT,
      expiry INTEGER
    );
  `);

  const failures = new Map();

  const selectUserByName = db.prepare('SELECT id, name, salt, verifier, key, generation FROM users WHERE name = ?');
  const insertUser = db.prepare('INSERT INTO users (id, name, salt, verifier, key, generation) VALUES (?, ?, ?, ?, ?, ?)');
  const pruneSessions = db.prepare('DELETE FROM sessions WHERE expiry <= ?');
  const insertSession = db.prepare('INSERT INTO sessions (digest, uid, expiry) VALUES (?, ?, ?)');
  const selectSessionAccount = db.prepare(`
    SELECT u.id, u.name, u.key, u.generation, s.expiry
    FROM users u
    JOIN sessions s ON s.uid = u.id
    WHERE s.digest = ? AND s.expiry > ?
  `);
  const deleteSession = db.prepare('DELETE FROM sessions WHERE digest = ?');
  const rotateProfileKey = db.prepare('UPDATE users SET key = ?, generation = ? WHERE id = ? AND generation = ?');
  const revokeOtherSessions = db.prepare('DELETE FROM sessions WHERE uid = ? AND digest <> ?');

  const handler = async (request, pathname, send) => {
    if (!IDENTITY_ROUTES.has(pathname)) return false;

    const reply = (status, body) => {
      send(status, body, 'application/json; charset=utf-8', {
        'Referrer-Policy': 'no-referrer',
        'X-Frame-Options': 'DENY',
      });
      return true;
    };

    const host = String(request.headers.host || '').trim();
    const forwardedHost = String(request.headers['x-forwarded-host'] || '').trim();
    if ((forwardedHost && forwardedHost.toLowerCase() !== host.toLowerCase()) ||
        !isLoopbackHostHeader(host) ||
        (request.socket?.remoteAddress && !isLoopbackAddress(request.socket.remoteAddress))) {
      request.resume();
      return reply(403, { error: '请使用本机地址。' });
    }

    const secFetchSite = String(request.headers['sec-fetch-site'] || '').toLowerCase();
    if (secFetchSite && !['same-origin', 'none'].includes(secFetchSite)) {
      request.resume();
      return reply(403, { error: '请求来源不匹配。' });
    }
    if (request.headers.origin && String(request.headers.origin).toLowerCase() !== ('http://' + host).toLowerCase()) {
      request.resume();
      return reply(403, { error: '请求来源不匹配。' });
    }

    const now = Math.floor(Date.now() / 1000);
    let payload = null;
    if (request.method === 'POST') {
      const body = await readIdentityJson(request);
      if (!body.ok) return reply(body.status, { error: body.error });
      payload = body.value;
    } else if (request.method !== 'GET') {
      request.resume();
      return reply(405, { error: '请求方法无效。' });
    }

    try {
      if (request.method === 'POST' && (pathname === '/api/register' || pathname === '/api/login')) {
        const rawName = payload.name;
        const password = payload.password;
        if (typeof rawName !== 'string' || typeof password !== 'string' ||
            rawName.trim().length < 1 || rawName.trim().length > 60 ||
            password.length < 8 || password.length > 256) {
          return reply(400, { error: '账号需为 1–60 个字符，密码需为 8–256 个字符。' });
        }
        const name = rawName.trim().toLowerCase();
        const account = selectUserByName.get(name);
        let uid;
        if (pathname === '/api/register') {
          if (account) {
            return reply(409, { error: '该账号已存在，请登录或换一个名称。' });
          }
          const salt = randomBytes(16);
          uid = randomBytes(16).toString('hex');
          const verifier = deriveVerifier(password, salt);
          const key = randomBytes(32).toString('hex');
          const generation = randomBytes(16).toString('hex');
          insertUser.run(uid, name, salt, verifier, key, generation);
        } else {
          const prev = failures.get(name) || [0, 0];
          const count = prev[1] <= now ? 0 : prev[0];
          if (count >= 8) {
            return reply(429, { error: '尝试过于频繁，请稍后再试。' });
          }
          const check = deriveVerifier(password, account ? Buffer.from(account.salt) : Buffer.alloc(16));
          const expected = account ? Buffer.from(account.verifier) : Buffer.alloc(check.length);
          if (!account || check.length !== expected.length || !timingSafeEqual(check, expected)) {
            failures.set(name, [count + 1, now + 60]);
            return reply(401, { error: '账号或密码错误。' });
          }
          failures.delete(name);
          uid = account.id;
        }
        const token = randomBytes(32).toString('base64url');
        pruneSessions.run(now);
        insertSession.run(digestToken(token), uid, now + TTL_SECONDS);
        return reply(200, { token });
      }

      const authHeader = String(request.headers.authorization || '');
      const rawToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!rawToken) return reply(401, { error: '请登录本人账号。' });
      const tokenDigest = digestToken(rawToken);
      const account = selectSessionAccount.get(tokenDigest, now);
      if (!account) return reply(401, { error: '请登录本人账号。' });

      if (request.method === 'GET' && pathname === '/api/session') {
        return reply(200, {
          id: account.id,
          name: account.name,
          key: account.key,
          generation: account.generation,
          expiry: account.expiry,
        });
      }
      if (request.method === 'POST' && pathname === '/api/logout') {
        deleteSession.run(tokenDigest);
        return reply(200, { ok: true });
      }
      if (request.method === 'POST' && pathname === '/api/profile/delete') {
        if (payload.generation !== account.generation) {
          return reply(409, { error: '档案已变更，请刷新页面。' });
        }
        const nextKey = randomBytes(32).toString('hex');
        const nextGen = randomBytes(16).toString('hex');
        const updated = rotateProfileKey.run(nextKey, nextGen, account.id, account.generation);
        if (updated.changes !== 1) {
          return reply(409, { error: '档案已变更，请刷新页面。' });
        }
        revokeOtherSessions.run(account.id, tokenDigest);
        return reply(200, { ok: true });
      }
      return reply(404, { error: '未找到该操作。' });
    } catch (err) {
      if (String(err?.message || '').includes('UNIQUE')) {
        return reply(409, { error: '账号已存在，请重新登录。' });
      }
      return reply(503, { error: '身份服务暂时不可用。' });
    }
  };

  handler.close = () => {
    try { db.close(); } catch {}
  };

  return handler;
}
