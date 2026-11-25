/* Lehrbegleiter-Abrufdienst (Phase 0)
 *
 * Holt mit dem WebUntis-Lehrerkonto genau zwei Dinge:
 *   1. den eigenen Stundenplan (aktuelle und nächste Woche) mit Vertretungen, Ausfällen,
 *      Beratungsstunden und Aufsichten
 *   2. die selbst erteilten Hausaufgaben im selben Zeitraum
 *
 * DATENSCHUTZ – keine Schülerdaten:
 *   - Es werden NIE Schülerlisten, Klassenbuch, Fehlzeiten, Noten oder Prüfungen abgefragt.
 *   - Die Antworten von WebUntis werden auf eine feste Liste von Feldern reduziert (siehe map*).
 *     Alles andere (z. B. Lehrkräfte-Namen, Erledigt-Status einzelner Schüler) wird verworfen.
 *   - Klassen- und Kursbezeichnungen (z. B. "Q1", "7b") bleiben erhalten.
 *   - Der Dienst speichert nichts dauerhaft. Ein Abruf liegt höchstens 10 Minuten im Zwischenspeicher.
 *
 * Läuft unverändert auf zwei Wegen:
 *   - Cloudflare Workers: der `export default` unten
 *   - eigener Server mit Node.js 18+: `node server.js`
 * Die Logik nutzt nur Web-Standards (fetch, Request, Response, Intl, btoa).
 *
 * Geheime Werte (Cloudflare: Secret, eigener Server: Umgebungsvariable; nie ins Repo):
 *   APP_KEY         beliebiges langes Passwort, das auch in der App eingetragen wird
 *   UNTIS_SERVER    z. B. "schule.webuntis.com" (steht in der Adresszeile von WebUntis)
 *   UNTIS_SCHOOL    optional: Schulname wie beim WebUntis-Login; leer = wird automatisch gesucht
 *   UNTIS_USER      WebUntis-Benutzername der Lehrkraft
 *   UNTIS_PASSWORD  WebUntis-Passwort der Lehrkraft
 * Normale Variable (wrangler.toml): ALLOWED_ORIGIN
 */

export const CACHE_SECONDS = 600;
const SERVICE = 'lehrbegleiter-sync';

/* Plattformunabhängiger Kern.
 * cache = { get(): Promise<object|null>, put(data): Promise<void> } – vom jeweiligen Host bereitgestellt. */
export async function handle(request, env, cache = null, fetchFn = fetch) {
  const cors = corsHeaders(request, env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const url = new URL(request.url);
  if (url.pathname === '/' || url.pathname === '/health') {
    return json({ ok: true, service: SERVICE }, 200, cors);
  }
  if (url.pathname !== '/sync') return json({ error: 'not_found' }, 404, cors);

  const key = request.headers.get('X-App-Key') || '';
  if (!env.APP_KEY || !timingSafeEqual(key, env.APP_KEY)) return json({ error: 'unauthorized' }, 401, cors);

  const fresh = url.searchParams.get('fresh') === '1';
  if (cache && !fresh) {
    const hit = await cache.get();
    if (hit) return json(hit, 200, cors);
  }
  const result = await collect(env, fetchFn);
  if (cache) await cache.put(result);
  return json(result, 200, cors);
}

/* Cloudflare-Workers-Einstieg */
export default {
  async fetch(request, env) {
    const key = new Request('https://cache.lehrbegleiter/sync');
    const cache = {
      async get() { const r = await caches.default.match(key); return r ? r.json() : null; },
      async put(data) {
        await caches.default.put(key, json(data, 200, { 'Cache-Control': `max-age=${CACHE_SECONDS}` }));
      }
    };
    return handle(request, env, cache);
  }
};

/* Zeitraum: Montag dieser Woche bis Sonntag nächster Woche (Europe/Berlin). */
export function weekRange(now = new Date()) {
  const today = ymd(now);
  const d = new Date(today + 'T12:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7; // Mo = 0
  const from = addDays(d, -dow);
  const to = addDays(from, 13);
  return { from, to };
}

export async function collect(env, fetchFn = fetch, now = new Date()) {
  const { from, to } = weekRange(now);
  const out = { updated: now.toISOString(), from: ymd(from), to: ymd(to), lessons: [], homework: [], errors: [] };
  if (!env.UNTIS_SERVER || !env.UNTIS_USER) {
    out.errors.push({ source: 'einrichtung', message: 'UNTIS_SERVER und UNTIS_USER fehlen im Abrufdienst' });
    return out;
  }
  try {
    const u = await untis(env, fetchFn, from, to);
    out.lessons = u.lessons;
    out.homework = u.homework;
    out.errors.push(...u.errors);
  } catch (e) {
    out.errors.push({ source: 'webuntis', message: String(e.message || e) });
  }
  return out;
}

/* ---------- WebUntis (inoffizielle Schnittstelle, Lehrerzugang) ---------- */

async function untis(env, fetchFn, from, to) {
  const server = String(env.UNTIS_SERVER).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const base = `https://${server}/WebUntis`;
  const school = env.UNTIS_SCHOOL || await findSchoolLoginName(server, fetchFn);
  const schoolCookie = `schoolname="_${btoa(unescape(encodeURIComponent(school)))}"`;
  let session = '';
  const cookie = () => `${session ? 'JSESSIONID=' + session + '; ' : ''}${schoolCookie}`;

  const rpc = async (method, params) => {
    const res = await fetchFn(`${base}/jsonrpc.do?school=${encodeURIComponent(school)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie() },
      body: JSON.stringify({ id: 'lhb', method, params, jsonrpc: '2.0' })
    });
    const data = await res.json().catch(() => ({}));
    if (data.error) throw new Error(`WebUntis ${method}: ${data.error.message || data.error.code}`);
    return data.result;
  };

  const auth = await rpc('authenticate', { user: env.UNTIS_USER, password: env.UNTIS_PASSWORD, client: 'Lehrbegleiter' });
  if (!auth || !auth.sessionId) throw new Error('WebUntis-Anmeldung fehlgeschlagen');
  session = auth.sessionId;
  const personId = auth.personId;
  const personType = auth.personType || 2; // 2 = Lehrkraft

  const errors = [];
  let lessons = [];
  let homework = [];

  let bearer = '';
  try {
    const t = await fetchFn(`${base}/api/token/new`, { headers: { Cookie: cookie() } });
    if (t.ok) bearer = (await t.text()).trim().replace(/^"|"$/g, '');
  } catch { /* optional */ }
  const rest = async path => {
    const headers = { Cookie: cookie(), Accept: 'application/json' };
    if (bearer) {
      headers.Authorization = 'Bearer ' + bearer;
      const tenant = jwtClaim(bearer, 'tenant_id');
      if (tenant) headers['Tenant-Id'] = String(tenant);
    }
    const res = await fetchFn(base + path, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status} für ${path.split('?')[0]}`);
    return res.json();
  };

  let rpcError = '';
  try {
    const tt = await rpc('getTimetable', {
      options: {
        element: { id: personId, type: personType },
        startDate: untisDate(from), endDate: untisDate(to),
        showSubstText: true, showInfo: true, showLsText: true,
        klasseFields: ['name'],
        subjectFields: ['name', 'longname'],
        roomFields: ['name']
      }
    });
    lessons = mapTimetable(tt || []);
  } catch (e) { rpcError = String(e.message || e); }

  if (!lessons.length) {
    try {
      const q = `start=${ymd(from)}&end=${ymd(to)}&format=4&resourceType=TEACHER&resources=${personId}&periodTypes=&timetableType=MY_TIMETABLE`;
      lessons = mapRestTimetable(await rest(`/api/rest/view/v1/timetable/entries?${q}`));
      if (!lessons.length) errors.push({ source: 'webuntis-stundenplan', message: rpcError || 'WebUntis hat keine Stunden geliefert' });
    } catch (e) {
      errors.push({ source: 'webuntis-stundenplan', message: rpcError || String(e.message || e) });
    }
  }

  try {
    const hw = await rest(`/api/homeworks/lessons?startDate=${untisDate(addDays(from, -14))}&endDate=${untisDate(to)}`);
    homework = mapHomework(hw, lessons).filter(h => h.due >= ymd(from));
  } catch (e) { errors.push({ source: 'webuntis-hausaufgaben', message: String(e.message || e) }); }

  try { await rpc('logout', {}); } catch { /* egal */ }
  return { lessons, homework, errors };
}

export async function findSchoolLoginName(server, fetchFn = fetch) {
  const sub = server.split('.')[0];
  const res = await fetchFn('https://mobile.webuntis.com/ms/schoolquery2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'lhb', method: 'searchSchool', params: [{ search: sub }], jsonrpc: '2.0' })
  });
  const data = await res.json().catch(() => ({}));
  const schools = (data.result && data.result.schools) || [];
  const hit = schools.find(s => String(s.server || '').toLowerCase() === server.toLowerCase())
    || schools.find(s => String(s.loginName || '').toLowerCase() === sub.toLowerCase())
    || (schools.length === 1 ? schools[0] : null);
  if (!hit || !hit.loginName) throw new Error('Schule nicht gefunden. Bitte UNTIS_SCHOOL eintragen.');
  return hit.loginName;
}

/* Art der Stunde: WebUntis lstype ls = Unterricht, oh = Sprechstunde/Beratung,
 * bs = Pausenaufsicht, sb = Bereitschaft, ex = Prüfung (nur Termin, keine Schülerdaten). */
const KIND = { ls: 'unterricht', oh: 'beratung', bs: 'aufsicht', sb: 'bereitschaft', ex: 'pruefung' };

/* Nur diese Felder verlassen den Dienst. */
export function mapTimetable(items) {
  return items.map(l => {
    const su = (l.su && l.su[0]) || {};
    const status = l.code === 'cancelled' ? 'cancelled' : l.code === 'irregular' ? 'changed' : 'normal';
    const kind = KIND[l.lstype] || 'unterricht';
    return {
      date: fromUntisDate(l.date),
      start: fromUntisTime(l.startTime),
      end: fromUntisTime(l.endTime),
      kind,
      subject: su.longname || su.name || l.lstext || (kind === 'beratung' ? 'Beratung' : kind === 'aufsicht' ? 'Aufsicht' : 'Unterricht'),
      short: su.name || '',
      classes: (l.kl || []).map(k => k.name).filter(Boolean),
      room: (l.ro && l.ro[0] && l.ro[0].name) || '',
      status,
      info: [l.substText, l.info].filter(Boolean).join(' · ').slice(0, 200)
    };
  }).filter(l => l.date && l.start)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

export function mapRestTimetable(data) {
  const days = (data && data.days) || [];
  const out = [];
  for (const day of days) {
    for (const g of day.gridEntries || []) {
      const fields = [];
      for (const k of Object.keys(g)) {
        if (/^position\d+$/.test(k) && Array.isArray(g[k])) g[k].forEach(p => p && p.current && fields.push(p.current));
      }
      const subj = fields.find(f => f.type === 'SUBJECT') || {};
      const room = fields.find(f => f.type === 'ROOM') || {};
      const classes = fields.filter(f => f.type === 'CLASS').map(f => f.shortName || f.displayName).filter(Boolean);
      const st = String(g.status || '').toUpperCase();
      const type = String(g.type || '').toUpperCase();
      const start = String((g.duration && g.duration.start) || '');
      const end = String((g.duration && g.duration.end) || '');
      const kind = /OFFICE/.test(type) ? 'beratung' : /BREAK|SUPERVISION/.test(type) ? 'aufsicht' : /STAND/.test(type) ? 'bereitschaft' : /EXAM/.test(type) ? 'pruefung' : 'unterricht';
      out.push({
        date: start.slice(0, 10) || day.date,
        start: start.slice(11, 16),
        end: end.slice(11, 16),
        kind,
        subject: subj.longName || subj.displayName || subj.shortName || g.lessonText || 'Unterricht',
        short: subj.shortName || '',
        classes,
        room: room.shortName || room.displayName || '',
        status: st === 'CANCELLED' ? 'cancelled' : (st && st !== 'REGULAR' && st !== 'NORMAL') ? 'changed' : 'normal',
        info: [g.substitutionText, g.lessonInfo].filter(Boolean).join(' · ').slice(0, 200)
      });
    }
  }
  return out.filter(l => l.date && l.start).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

/* Hausaufgaben: nur Text, Fach, Klasse, Datum. Erledigt-Status oder Zuordnungen zu einzelnen
 * Schülern (records, elementIds usw.) werden bewusst nicht übernommen.
 * Die Klasse kommt aus dem Stundenplan: Stunde mit gleichem Fach am Tag der Erteilung. */
export function mapHomework(data, lessons = []) {
  const d = (data && data.data) || {};
  const byId = new Map((d.lessons || []).map(l => [l.id, l]));
  return (d.homeworks || []).map(h => {
    const lesson = byId.get(h.lessonId) || {};
    const subject = lesson.subject || '';
    const assigned = fromUntisDate(h.date);
    const match = lessons.find(l => l.date === assigned && subject && (l.short === subject || l.subject === subject))
      || lessons.find(l => subject && (l.short === subject || l.subject === subject) && l.classes.length);
    return {
      id: 'untis:' + h.id,
      subject: match ? match.subject : subject,
      classes: match ? match.classes : [],
      text: [h.text, h.remark].filter(Boolean).join(' – ').trim().slice(0, 500),
      due: fromUntisDate(h.dueDate),
      assigned
    };
  }).filter(h => h.text && h.due)
    .sort((a, b) => a.due.localeCompare(b.due));
}

function jwtClaim(token, claim) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part + '='.repeat((4 - part.length % 4) % 4)))[claim];
  } catch { return null; }
}

/* ---------- Helfer ---------- */

function addDays(d, n) { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }
function ymd(d) { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(d); }
function untisDate(d) { return Number(ymd(d).replace(/-/g, '')); }
function fromUntisDate(n) { const s = String(n || ''); return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null; }
function fromUntisTime(n) { const s = String(n || 0).padStart(4, '0'); return `${s.slice(0, 2)}:${s.slice(2)}`; }

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0] || '',
    'Access-Control-Allow-Headers': 'X-App-Key',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Vary': 'Origin'
  };
}
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
