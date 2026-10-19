// ChoreScores API. Everything under /api/* lands here; all other paths are
// served from ./public by the static assets binding.

const SESSION_COOKIE = 'sid';
const SESSION_MAX_AGE = 400 * 24 * 3600; // seconds; browsers cap cookies at 400 days
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;
const MAX_USERS = 6;
const MAX_IMAGE_CHARS = 200_000;
const USER_COLORS = ['#6c5ce7', '#e17055', '#00b894', '#0984e3', '#fdcb6e', '#e84393'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await route(request, env, url);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: 'Internal error' }, 500);
    }
  },
};

async function route(request, env, url) {
  const { pathname } = url;
  const method = request.method;

  if (method !== 'GET') checkOrigin(request, url);

  if (pathname === '/api/login' && method === 'POST') return login(request, env);
  if (pathname === '/api/logout' && method === 'POST') return logout(request, env);

  const user = await requireUser(request, env);

  if (pathname === '/api/state' && method === 'GET') return getState(env, user, url);
  if (pathname === '/api/completions' && method === 'POST') return addCompletion(request, env, user);
  if (pathname === '/api/chores' && method === 'POST') return saveChore(request, env, null);

  let m;
  if ((m = pathname.match(/^\/api\/completions\/(\d+)$/)) && method === 'DELETE') {
    return deleteCompletion(env, user, Number(m[1]));
  }
  if ((m = pathname.match(/^\/api\/chores\/(\d+)$/))) {
    if (method === 'PUT') return saveChore(request, env, Number(m[1]));
    if (method === 'DELETE') return archiveChore(env, Number(m[1]));
  }
  throw new HttpError(404, 'Not found');
}

// ---------- auth ----------

async function login(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const now = Date.now();
  const { failures } = await env.DB.prepare(
    'SELECT COUNT(*) AS failures FROM login_attempts WHERE ip = ? AND at > ?',
  ).bind(ip, now - LOGIN_WINDOW_MS).first();
  if (failures >= LOGIN_MAX_FAILURES) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');

  const body = await readJson(request);
  if (!env.APP_PIN) throw new HttpError(500, 'APP_PIN secret is not set');
  if (!(await safeEqual(String(body.pin ?? ''), env.APP_PIN))) {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO login_attempts (ip, at) VALUES (?, ?)').bind(ip, now),
      env.DB.prepare('DELETE FROM login_attempts WHERE at < ?').bind(now - LOGIN_WINDOW_MS),
    ]);
    throw new HttpError(401, 'Wrong PIN');
  }

  // Step 1: PIN only, so the client can show "who are you?".
  if (body.userId == null && body.name == null) {
    return json({ users: await listUsers(env) });
  }

  // Step 2: pick an existing person or add a new one.
  let userId = Number(body.userId);
  if (body.name != null) {
    const name = cleanText(body.name, 30);
    if (!name) throw new HttpError(400, 'Name is required');
    const users = await listUsers(env);
    const existing = users.find((u) => u.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      userId = existing.id;
    } else {
      if (users.length >= MAX_USERS) throw new HttpError(400, 'Household is full');
      const row = await env.DB.prepare(
        'INSERT INTO users (name, color, created_at) VALUES (?, ?, ?) RETURNING id',
      ).bind(name, USER_COLORS[users.length % USER_COLORS.length], now).first();
      userId = row.id;
    }
  }
  const user = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first();
  if (!user) throw new HttpError(400, 'Unknown person');

  const token = randomToken();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), userId, now).run();
  return json({ ok: true }, 200, {
    'Set-Cookie': `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`,
  });
}

async function logout(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return json({ ok: true }, 200, {
    'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  });
}

async function requireUser(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) throw new HttpError(401, 'Not signed in');
  const user = await env.DB.prepare(
    'SELECT u.id, u.name, u.color FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?',
  ).bind(await sha256(token)).first();
  if (!user) throw new HttpError(401, 'Not signed in');
  return user;
}

// Mutating requests must come from our own origin (CSRF guard on top of SameSite).
function checkOrigin(request, url) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) throw new HttpError(403, 'Bad origin');
}

// ---------- data ----------

function listUsers(env) {
  return env.DB.prepare('SELECT id, name, color FROM users ORDER BY id').all().then((r) => r.results);
}

async function choresRev(env) {
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'chores_rev'").first();
  return row.value;
}

// One call for the client: who am I, everyone, chores (only when changed), and
// completions from `from` onwards.
async function getState(env, user, url) {
  const from = Number(url.searchParams.get('from')) || 0;
  const knownRev = Number(url.searchParams.get('rev')) || 0;
  const rev = await choresRev(env);
  const [users, completions, chores] = await Promise.all([
    listUsers(env),
    completionsBetween(env, from, Number.MAX_SAFE_INTEGER),
    rev === knownRev
      ? null
      : env.DB.prepare('SELECT id, name, icon, image, points, sort, archived FROM chores ORDER BY sort, id')
          .all().then((r) => r.results),
  ]);
  return json({ me: user, users, completions, chores, choresRev: rev });
}

function completionsBetween(env, from, to) {
  return env.DB.prepare(
    'SELECT id, chore_id, user_id, points, done_at FROM completions WHERE done_at >= ? AND done_at < ? ORDER BY done_at DESC',
  ).bind(from, to).all().then((r) => r.results);
}

async function addCompletion(request, env, user) {
  const body = await readJson(request);
  const chore = await env.DB.prepare('SELECT id, points FROM chores WHERE id = ? AND archived = 0')
    .bind(Number(body.choreId)).first();
  if (!chore) throw new HttpError(404, 'Chore not found');
  const row = await env.DB.prepare(
    'INSERT INTO completions (chore_id, user_id, points, done_at) VALUES (?, ?, ?, ?) RETURNING id, chore_id, user_id, points, done_at',
  ).bind(chore.id, user.id, chore.points, Date.now()).first();
  return json({ completion: row }, 201);
}

async function deleteCompletion(env, user, id) {
  const res = await env.DB.prepare('DELETE FROM completions WHERE id = ? AND user_id = ?').bind(id, user.id).run();
  if (!res.meta.changes) throw new HttpError(404, 'Not found or not yours');
  return json({ ok: true });
}

async function saveChore(request, env, id) {
  const body = await readJson(request);
  const name = cleanText(body.name, 40);
  const icon = cleanText(body.icon ?? '', 16) || null;
  const image = body.image || null;
  const points = Number(body.points);
  if (!name) throw new HttpError(400, 'Name is required');
  if (!Number.isInteger(points) || points < 1 || points > 1000) throw new HttpError(400, 'Points must be 1–1000');
  if (image && (typeof image !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > MAX_IMAGE_CHARS)) {
    throw new HttpError(400, 'Image must be a small JPEG, PNG or WebP');
  }

  const bump = env.DB.prepare("UPDATE meta SET value = value + 1 WHERE key = 'chores_rev'");
  if (id == null) {
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO chores (name, icon, image, points, sort, created_at) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM chores), ?)',
      ).bind(name, icon, image, points, Date.now()),
      bump,
    ]);
  } else {
    const [res] = await env.DB.batch([
      env.DB.prepare('UPDATE chores SET name = ?, icon = ?, image = ?, points = ? WHERE id = ? AND archived = 0')
        .bind(name, icon, image, points, id),
      bump,
    ]);
    if (!res.meta.changes) throw new HttpError(404, 'Chore not found');
  }
  return json({ ok: true });
}

async function archiveChore(env, id) {
  await env.DB.batch([
    env.DB.prepare('UPDATE chores SET archived = 1 WHERE id = ?').bind(id),
    env.DB.prepare("UPDATE meta SET value = value + 1 WHERE key = 'chores_rev'"),
  ]);
  return json({ ok: true });
}

// ---------- helpers ----------

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

function cleanText(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]);
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Compare hashes so timing doesn't leak how much of the PIN matched.
async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}
