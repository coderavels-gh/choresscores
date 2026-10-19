// ChoreScores client. Plain JS, no build step.
// Weeks run Monday 00:00 → next Monday 00:00 in the phone's local time.

const POLL_MS = 30_000;
const HISTORY_WEEKS = 12;
const UNDO_MS = 6_000;
const EMOJI = ['🍽️', '🥣', '🚽', '🧺', '👕', '🧦', '🗄️', '🛏️', '🛌', '🧹', '🪶', '🛒', '🗑️', '🍳', '🧽', '🪴',
  '🐕', '🐈', '🚗', '🧴', '🪟', '🛁', '🧼', '📦', '💡', '🔧', '👶', '💊', '📬', '🧯', '❄️', '✅'];

const state = {
  me: null,
  users: [],
  chores: new Map(),
  choresRev: 0,
  completions: [], // newest first, from state.from onwards
  from: 0,
  tab: 'log',
  weekOffset: 0, // 0 = this week, -1 = last week, ...
  signature: '',
};

const app = document.getElementById('app');
const sheet = document.getElementById('sheet');
const toast = document.getElementById('toast');

// ---------- utils ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function weekStart(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

function addWeeks(ts, n) {
  const d = new Date(ts);
  d.setDate(d.getDate() + 7 * n);
  return d.getTime();
}

const fmtDay = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const fmtShort = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const fmtTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

function weekLabel(ws) {
  const end = new Date(ws);
  end.setDate(end.getDate() + 6);
  return `${fmtShort.format(ws)} – ${fmtShort.format(end)}`;
}

function ago(ts) {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

function userById(id) {
  return state.users.find((u) => u.id === id) || { name: 'Someone', color: '#999' };
}

function choreIcon(chore, cls = 'icon') {
  if (chore?.image) return `<img class="${cls}" src="${esc(chore.image)}" alt="">`;
  return `<span class="${cls}">${esc(chore?.icon || '✅')}</span>`;
}

function inRange(from, to) {
  return state.completions.filter((c) => c.done_at >= from && c.done_at < to);
}

function totalsByUser(completions) {
  const totals = new Map(state.users.map((u) => [u.id, { points: 0, count: 0 }]));
  for (const c of completions) {
    const t = totals.get(c.user_id) || { points: 0, count: 0 };
    t.points += c.points;
    t.count += 1;
    totals.set(c.user_id, t);
  }
  return totals;
}

// ---------- api ----------

async function api(path, { method = 'GET', body, allow401 = false } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !allow401) {
    renderLogin();
    throw new Error('Signed out');
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function refresh() {
  if (!state.from) state.from = addWeeks(weekStart(Date.now()), -(HISTORY_WEEKS - 1));
  const data = await api(`/api/state?from=${state.from}&rev=${state.choresRev}`);
  state.me = data.me;
  state.users = data.users;
  state.completions = data.completions;
  if (data.chores) {
    state.chores = new Map(data.chores.map((c) => [c.id, c]));
    state.choresRev = data.choresRev;
  }
  const signature = JSON.stringify([data.users, data.completions, state.choresRev]);
  if (signature !== state.signature || !app.querySelector('#view')) {
    state.signature = signature;
    render();
  }
}

// ---------- login ----------

function renderLogin(error = '') {
  app.innerHTML = `
    <main class="login">
      <div class="login-logo">🧹</div>
      <h1>ChoreScores</h1>
      <p class="muted">Enter your household PIN</p>
      <form id="pin-form" class="stack">
        <input id="pin" type="password" inputmode="numeric" autocomplete="current-password" placeholder="PIN" required>
        <button class="btn primary" type="submit">Continue</button>
        <p class="error">${esc(error)}</p>
      </form>
    </main>`;
  document.getElementById('pin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = document.getElementById('pin').value;
    try {
      const { users } = await api('/api/login', { method: 'POST', body: { pin }, allow401: true });
      renderWhoAmI(pin, users);
    } catch (err) {
      renderLogin(err.message);
    }
  });
}

function renderWhoAmI(pin, users) {
  app.innerHTML = `
    <main class="login">
      <h1>Who are you?</h1>
      <div class="stack">
        ${users.map((u) => `<button class="btn person" data-user="${u.id}"><span class="dot" style="background:${esc(u.color)}"></span>${esc(u.name)}</button>`).join('')}
      </div>
      <form id="new-form" class="stack">
        <p class="muted">${users.length ? 'Or add yourself' : 'Add yourself'}</p>
        <input id="new-name" maxlength="30" placeholder="Your name" required>
        <button class="btn primary" type="submit">Join</button>
        <p class="error"></p>
      </form>
    </main>`;
  const finish = async (body) => {
    try {
      await api('/api/login', { method: 'POST', body: { pin, ...body }, allow401: true });
      state.signature = '';
      await refresh();
    } catch (err) {
      app.querySelector('.error').textContent = err.message;
    }
  };
  app.querySelectorAll('[data-user]').forEach((b) => b.addEventListener('click', () => finish({ userId: Number(b.dataset.user) })));
  document.getElementById('new-form').addEventListener('submit', (e) => {
    e.preventDefault();
    finish({ name: document.getElementById('new-name').value });
  });
}

// ---------- main views ----------

const TABS = [
  { id: 'log', label: 'Log', icon: '✓' },
  { id: 'week', label: 'Week', icon: '▤' },
  { id: 'history', label: 'History', icon: '↺' },
  { id: 'chores', label: 'Chores', icon: '✎' },
];

function render() {
  const views = { log: logView, week: weekView, history: historyView, chores: choresView };
  app.innerHTML = `
    <main id="view" class="view">${views[state.tab]()}</main>
    <nav class="tabs">
      ${TABS.map((t) => `<button data-tab="${t.id}" class="${t.id === state.tab ? 'active' : ''}"><span>${t.icon}</span>${t.label}</button>`).join('')}
    </nav>`;
}

function scoreStrip(completions) {
  const totals = totalsByUser(completions);
  return `<div class="strip">${state.users.map((u) => {
    const t = totals.get(u.id);
    return `<div class="chip"><span class="dot" style="background:${esc(u.color)}"></span>${esc(u.name)}<b>${t.points}</b></div>`;
  }).join('')}</div>`;
}

function logView() {
  const ws = weekStart(Date.now());
  const active = [...state.chores.values()].filter((c) => !c.archived);
  const lastByChore = new Map();
  for (const c of state.completions) if (!lastByChore.has(c.chore_id)) lastByChore.set(c.chore_id, c);

  return `
    <header class="head">
      <div><h1>Done something?</h1><p class="muted">This week · ${weekLabel(ws)}</p></div>
    </header>
    ${scoreStrip(inRange(ws, addWeeks(ws, 1)))}
    <div class="grid">
      ${active.map((ch) => {
        const last = lastByChore.get(ch.id);
        const lastText = last ? `${esc(userById(last.user_id).name)} · ${ago(last.done_at)}` : 'not yet';
        return `<button class="tile" data-log="${ch.id}">
          ${choreIcon(ch)}
          <span class="tile-name">${esc(ch.name)}</span>
          <span class="tile-pts">+${ch.points}</span>
          <span class="tile-last">${lastText}</span>
        </button>`;
      }).join('')}
    </div>
    ${active.length ? '' : '<p class="empty">No chores yet. Add some in the Chores tab.</p>'}`;
}

function weekView() {
  const ws = addWeeks(weekStart(Date.now()), state.weekOffset);
  const done = inRange(ws, addWeeks(ws, 1));
  const totals = totalsByUser(done);
  const totalPoints = done.reduce((sum, c) => sum + c.points, 0);

  // Per-chore breakdown: chore -> userId -> count
  const byChore = new Map();
  for (const c of done) {
    if (!byChore.has(c.chore_id)) byChore.set(c.chore_id, new Map());
    const m = byChore.get(c.chore_id);
    m.set(c.user_id, (m.get(c.user_id) || 0) + 1);
  }

  // Activity log grouped by day
  const days = [];
  for (const c of done) {
    const key = new Date(c.done_at).toDateString();
    if (days.at(-1)?.key !== key) days.push({ key, ts: c.done_at, items: [] });
    days.at(-1).items.push(c);
  }

  return `
    <header class="head">
      <button class="icon-btn" data-week="-1" aria-label="Previous week">‹</button>
      <div class="center"><h1>${state.weekOffset === 0 ? 'This week' : weekLabel(ws)}</h1>
        <p class="muted">${state.weekOffset === 0 ? weekLabel(ws) : 'Mon – Sun'}</p></div>
      <button class="icon-btn" data-week="1" aria-label="Next week" ${state.weekOffset === 0 ? 'disabled' : ''}>›</button>
    </header>

    <section class="cards">
      ${state.users.map((u) => {
        const t = totals.get(u.id);
        return `<div class="card person-card" style="--c:${esc(u.color)}">
          <div class="pc-name"><span class="dot"></span>${esc(u.name)}</div>
          <div class="pc-points">${t.points}<small> pts</small></div>
          <div class="muted">${t.count} task${t.count === 1 ? '' : 's'}</div>
        </div>`;
      }).join('')}
    </section>
    ${totalPoints ? `<div class="split">${state.users.map((u) => {
      const share = (totals.get(u.id).points / totalPoints) * 100;
      return share ? `<span style="width:${share}%;background:${esc(u.color)}"></span>` : '';
    }).join('')}</div>` : ''}

    <button class="btn whatsapp" data-share="${ws}">Share week to WhatsApp</button>

    <h2>By chore</h2>
    ${byChore.size ? `<div class="card list">${[...byChore].map(([choreId, counts]) => {
      const ch = state.chores.get(choreId);
      return `<div class="row">
        ${choreIcon(ch, 'icon sm')}
        <span class="grow">${esc(ch?.name || 'Deleted chore')}</span>
        ${state.users.filter((u) => counts.get(u.id)).map((u) =>
          `<span class="count" style="--c:${esc(u.color)}">${esc(u.name)} ×${counts.get(u.id)}</span>`).join('')}
      </div>`;
    }).join('')}</div>` : '<p class="empty">Nothing logged this week.</p>'}

    ${days.length ? '<h2>Activity</h2>' : ''}
    ${days.map((d) => `
      <h3>${fmtDay.format(d.ts)}</h3>
      <div class="card list">${d.items.map((c) => {
        const ch = state.chores.get(c.chore_id);
        const u = userById(c.user_id);
        return `<div class="row">
          <span class="time">${fmtTime.format(c.done_at)}</span>
          ${choreIcon(ch, 'icon sm')}
          <span class="grow">${esc(ch?.name || 'Deleted chore')}<br><small class="muted"><span class="dot" style="background:${esc(u.color)}"></span>${esc(u.name)}</small></span>
          <span class="pts">+${c.points}</span>
          ${c.user_id === state.me.id ? `<button class="icon-btn sm" data-delete="${c.id}" aria-label="Remove">✕</button>` : ''}
        </div>`;
      }).join('')}</div>`).join('')}`;
}

function historyView() {
  const current = weekStart(Date.now());
  const weeks = [];
  for (let ws = current, i = 0; ws >= state.from; ws = addWeeks(ws, -1), i--) weeks.push({ ws, offset: i });

  return `
    <header class="head"><div><h1>History</h1><p class="muted">Points per week</p></div></header>
    <div class="card list">
      ${weeks.map(({ ws, offset }) => {
        const totals = totalsByUser(inRange(ws, addWeeks(ws, 1)));
        return `<button class="row" data-open-week="${offset}">
          <span class="grow">${offset === 0 ? 'This week' : weekLabel(ws)}</span>
          ${state.users.map((u) => `<span class="count" style="--c:${esc(u.color)}">${esc(u.name)} ${totals.get(u.id).points}</span>`).join('')}
          <span class="muted">›</span>
        </button>`;
      }).join('')}
    </div>
    <button class="btn" data-older>Load older weeks</button>`;
}

function choresView() {
  const active = [...state.chores.values()].filter((c) => !c.archived);
  return `
    <header class="head">
      <div><h1>Chores</h1><p class="muted">Shared list · tap to edit</p></div>
      <button class="btn primary sm" data-edit="new">+ Add</button>
    </header>
    <div class="card list">
      ${active.map((ch) => `<button class="row" data-edit="${ch.id}">
        ${choreIcon(ch, 'icon sm')}<span class="grow">${esc(ch.name)}</span><span class="pts">${ch.points} pts</span>
      </button>`).join('')}
    </div>
    <p class="muted small">Changing points only affects new entries; past weeks keep the points they were logged with.</p>
    <div class="signed-in">
      <span><span class="dot" style="background:${esc(state.me.color)}"></span>Signed in as ${esc(state.me.name)}</span>
      <button class="btn sm" data-logout>Sign out</button>
    </div>`;
}

// ---------- chore editor ----------

function openEditor(id) {
  const ch = id === 'new' ? { name: '', icon: '✅', image: null, points: 5 } : { ...state.chores.get(Number(id)) };
  const draw = () => {
    sheet.innerHTML = `
      <form class="sheet-body stack" id="chore-form">
        <div class="sheet-head">
          <button type="button" class="btn sm" data-close>Cancel</button>
          <b>${id === 'new' ? 'New chore' : 'Edit chore'}</b>
          <button type="submit" class="btn primary sm">Save</button>
        </div>
        <div class="preview">${choreIcon(ch, 'icon lg')}</div>
        <label>Name<input name="name" maxlength="40" required value="${esc(ch.name)}"></label>
        <label>Points
          <div class="stepper">
            <button type="button" data-step="-1">−</button>
            <input name="points" type="number" inputmode="numeric" min="1" max="1000" required value="${ch.points}">
            <button type="button" data-step="1">+</button>
          </div>
        </label>
        <label>Icon</label>
        <div class="emoji-grid">${EMOJI.map((e) => `<button type="button" data-emoji="${e}" class="${!ch.image && ch.icon === e ? 'sel' : ''}">${e}</button>`).join('')}</div>
        <div class="row-actions">
          <input name="customEmoji" maxlength="16" placeholder="Or type any emoji" value="${EMOJI.includes(ch.icon) ? '' : esc(ch.icon || '')}">
          <label class="btn sm">📷 Photo<input type="file" accept="image/*" hidden data-photo></label>
          ${ch.image ? '<button type="button" class="btn sm" data-clear-photo>Remove photo</button>' : ''}
        </div>
        ${id === 'new' ? '' : '<button type="button" class="btn danger" data-archive>Delete chore</button>'}
        <p class="error"></p>
      </form>`;
  };
  draw();
  sheet.hidden = false;

  const form = () => sheet.querySelector('#chore-form');
  // Keep typed values when redrawing after icon/photo changes.
  const keep = () => {
    ch.name = form().name.value;
    ch.points = Number(form().points.value) || ch.points;
  };

  sheet.onclick = async (e) => {
    const t = e.target.closest('button');
    if (e.target === sheet || t?.dataset.close != null) return closeEditor();
    if (!t) return;
    if (t.dataset.step) {
      const input = form().points;
      input.value = Math.max(1, (Number(input.value) || 0) + Number(t.dataset.step));
    } else if (t.dataset.emoji) {
      keep();
      Object.assign(ch, { icon: t.dataset.emoji, image: null });
      draw();
    } else if (t.dataset.clearPhoto != null) {
      keep();
      ch.image = null;
      draw();
    } else if (t.dataset.archive != null) {
      if (!confirm(`Delete "${ch.name}"? Past entries stay in history.`)) return;
      await api(`/api/chores/${ch.id}`, { method: 'DELETE' });
      closeEditor();
      await refresh();
    }
  };

  sheet.onchange = async (e) => {
    if (e.target.dataset.photo != null && e.target.files[0]) {
      keep();
      ch.image = await resizeImage(e.target.files[0], 128);
      draw();
    }
  };

  sheet.oninput = (e) => {
    if (e.target.name === 'customEmoji' && e.target.value.trim()) {
      ch.icon = e.target.value.trim();
      ch.image = null;
      sheet.querySelector('.preview').innerHTML = choreIcon(ch, 'icon lg');
      sheet.querySelectorAll('[data-emoji]').forEach((b) => b.classList.remove('sel'));
    }
  };

  sheet.onsubmit = async (e) => {
    e.preventDefault();
    keep();
    const body = { name: ch.name, points: Number(form().points.value), icon: ch.icon, image: ch.image };
    try {
      await api(id === 'new' ? '/api/chores' : `/api/chores/${ch.id}`, { method: id === 'new' ? 'POST' : 'PUT', body });
      closeEditor();
      await refresh();
    } catch (err) {
      sheet.querySelector('.error').textContent = err.message;
    }
  };
}

function closeEditor() {
  sheet.hidden = true;
  sheet.innerHTML = '';
}

// Center-crop to a square and shrink, so photos stay a few KB in the database.
function resizeImage(file, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// ---------- actions ----------

let toastTimer;
function showToast(message, undo) {
  clearTimeout(toastTimer);
  toast.innerHTML = `<span>${esc(message)}</span>${undo ? '<button>Undo</button>' : ''}`;
  toast.hidden = false;
  if (undo) toast.querySelector('button').onclick = () => { toast.hidden = true; undo(); };
  toastTimer = setTimeout(() => { toast.hidden = true; }, undo ? UNDO_MS : 2500);
}

async function logChore(choreId, tile) {
  tile.classList.add('pressed');
  try {
    const { completion } = await api('/api/completions', { method: 'POST', body: { choreId } });
    const ch = state.chores.get(choreId);
    await refresh();
    showToast(`${ch.name} · +${completion.points}`, async () => {
      await api(`/api/completions/${completion.id}`, { method: 'DELETE' });
      await refresh();
    });
  } catch (err) {
    showToast(err.message);
  } finally {
    tile.classList.remove('pressed');
  }
}

function shareWeek(ws) {
  const done = inRange(ws, addWeeks(ws, 1));
  const totals = totalsByUser(done);
  const lines = [`🧹 *Chores · ${weekLabel(ws)}*`, ''];
  for (const u of state.users) {
    const t = totals.get(u.id);
    lines.push(`${u.name}: ${t.points} pts (${t.count} task${t.count === 1 ? '' : 's'})`);
  }
  const byChore = new Map();
  for (const c of done) {
    const key = `${c.chore_id}:${c.user_id}`;
    byChore.set(key, (byChore.get(key) || 0) + 1);
  }
  if (byChore.size) {
    lines.push('');
    for (const u of state.users) {
      const items = [...byChore].filter(([k]) => k.endsWith(`:${u.id}`))
        .map(([k, n]) => `${state.chores.get(Number(k.split(':')[0]))?.name || 'Deleted chore'}${n > 1 ? ` ×${n}` : ''}`);
      if (items.length) lines.push(`${u.name}: ${items.join(', ')}`);
    }
  }
  window.location.href = `https://wa.me/?text=${encodeURIComponent(lines.join('\n'))}`;
}

app.addEventListener('click', async (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  const d = t.dataset;
  try {
    if (d.tab) {
      state.tab = d.tab;
      if (d.tab === 'week') state.weekOffset = 0;
      render();
      window.scrollTo(0, 0);
    } else if (d.log) {
      await logChore(Number(d.log), t);
    } else if (d.week) {
      state.weekOffset = Math.min(0, state.weekOffset + Number(d.week));
      const ws = addWeeks(weekStart(Date.now()), state.weekOffset);
      if (ws < state.from) {
        state.from = addWeeks(state.from, -HISTORY_WEEKS);
        await refresh();
      }
      render();
    } else if (d.openWeek) {
      state.tab = 'week';
      state.weekOffset = Number(d.openWeek);
      render();
      window.scrollTo(0, 0);
    } else if (d.older != null) {
      state.from = addWeeks(state.from, -HISTORY_WEEKS);
      await refresh();
    } else if (d.delete) {
      if (!confirm('Remove this entry?')) return;
      await api(`/api/completions/${d.delete}`, { method: 'DELETE' });
      await refresh();
    } else if (d.share) {
      shareWeek(Number(d.share));
    } else if (d.edit) {
      openEditor(d.edit);
    } else if (d.logout != null) {
      await api('/api/logout', { method: 'POST' });
      state.signature = '';
      renderLogin();
    }
  } catch (err) {
    if (err.message !== 'Signed out') showToast(err.message);
  }
});

// ---------- boot ----------

function poll() {
  if (document.visibilityState === 'visible' && app.querySelector('#view') && sheet.hidden) refresh().catch(() => {});
}
setInterval(poll, POLL_MS);
document.addEventListener('visibilitychange', poll);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');

refresh().catch((err) => {
  if (err.message !== 'Signed out') app.innerHTML = `<p class="empty">Couldn't load: ${esc(err.message)}</p>`;
});
