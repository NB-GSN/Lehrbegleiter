/* Lehrbegleiter – Phase 0
 * Zeigt Stundenplan (diese + nächste Woche) und erteilte Hausaufgaben aus dem Abrufdienst.
 * Alle Daten bleiben im Browser (localStorage). Es werden keine Schülerdaten verarbeitet. */
'use strict';

const STORE = 'lehrbegleiter.v1';
const AUTO_SYNC_MIN = 30;
const EVENING_HOUR = 18; // ab 18 Uhr zeigt "Heute" schon den nächsten Schultag

const DEFAULT = { settings: { name: '', syncUrl: '', syncKey: '' }, sync: null };
let S = load();
let syncing = false;
let weekOffset = 0;

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || 'null');
    return raw ? { ...DEFAULT, ...raw, settings: { ...DEFAULT.settings, ...(raw.settings || {}) } } : structuredClone(DEFAULT);
  } catch { return structuredClone(DEFAULT); }
}
function save() { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch { /* privat-Modus */ } }

/* ---------- Datum ---------- */
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const monday = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return addDays(x, -((x.getDay() + 6) % 7)); };
const fromIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const WD = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const fmtDay = s => { const d = fromIso(s); return `${WD[d.getDay()]}, ${d.getDate()}. ${d.toLocaleString('de-DE', { month: 'long' })}`; };
const fmtShort = s => { const d = fromIso(s); return `${WD[d.getDay()].slice(0, 2)} ${d.getDate()}.${d.getMonth() + 1}.`; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Daten ---------- */
const configured = () => !!(S.settings.syncUrl && S.settings.syncKey);
const isDemo = () => !configured() || !S.sync;
function data() { return isDemo() ? demoData() : S.sync; }
const lessonsOn = day => data().lessons.filter(l => l.date === day);
const teaching = l => l.kind === 'unterricht' && l.status !== 'cancelled';

/* Der Tag, um den es auf "Heute" geht: ab 18 Uhr oder am Wochenende der nächste Tag mit Stunden. */
function focusDay(now = new Date()) {
  let d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (now.getHours() >= EVENING_HOUR) d = addDays(d, 1);
  let firstWeekday = null;
  for (let i = 0; i < 14; i++, d = addDays(d, 1)) {
    if (d.getDay() % 6 === 0) continue;
    if (!firstWeekday) firstWeekday = iso(d);
    if (lessonsOn(iso(d)).length) return iso(d);
  }
  return firstWeekday;
}

/* ---------- Ansichten ---------- */
const QUOTES = [
  'Gute Planung ist halbe Stunde gewonnen.',
  'Heute ist ein guter Tag, um jemanden für Geschichte zu begeistern.',
  'Kleine Schritte, klarer Kopf, starke Stunden.',
  'Du musst nicht alles heute schaffen. Nur das Richtige.',
  'Jede gute Stunde beginnt mit einer guten Frage.',
  'Code, Quellen, Kaffee: läuft.',
  'Ruhe bewahren, Tafel wischen, weitermachen.'
];
function greeting(now) {
  const h = now.getHours();
  const base = h < 11 ? 'Guten Morgen' : h < 17 ? 'Hallo' : 'Guten Abend';
  return S.settings.name ? `${base}, ${S.settings.name}` : base;
}

function viewHeute() {
  const now = new Date();
  const day = focusDay(now);
  const isToday = day === iso(now);
  const all = lessonsOn(day);
  const lessons = all;
  const units = all.filter(teaching);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const done = isToday ? units.filter(l => toMin(l.end) <= nowMin).length : 0;
  const pct = units.length ? Math.round(done / units.length * 100) : 0;
  const next = isToday ? all.find(l => l.status !== 'cancelled' && toMin(l.end) > nowMin) : all.find(l => l.status !== 'cancelled');
  const subs = all.filter(l => l.status === 'changed').length;
  const cancels = all.filter(l => l.status === 'cancelled').length;
  const extra = all.filter(l => l.kind !== 'unterricht').length;
  const dueSoon = data().homework.filter(h => h.due >= iso(now) && h.due <= iso(addDays(now, 7))).length;
  const quote = QUOTES[(fromIso(day).getDate()) % QUOTES.length];

  let nextHtml;
  if (!all.length) nextHtml = `<div><div class="next-title">Unterrichtsfrei 🎉</div><p class="muted">Kein Eintrag im Stundenplan.</p></div>`;
  else if (!next) nextHtml = `<div><div class="next-title">Geschafft! 💪</div><p class="muted">Alle ${units.length} Stunden für heute sind durch.</p></div>`;
  else {
    const isNow = isToday && toMin(next.start) <= nowMin;
    const mins = toMin(next.start) - nowMin;
    const cd = !isToday ? `${isTomorrow(day, now) ? 'Morgen' : fmtShort(day)} um ${next.start}` : isNow ? 'Läuft gerade' : mins < 60 ? `in ${mins} Min` : `um ${next.start}`;
    nextHtml = `<div><div class="eyebrow">${isNow ? 'Jetzt' : 'Als Nächstes'}</div>
      <div class="next-title">${esc(lessonTitle(next))}</div>
      <div class="muted">${esc([next.start + '–' + next.end, next.room && 'Raum ' + next.room].filter(Boolean).join(' · '))}</div>
      <span class="countdown">${cd}</span></div>`;
  }

  return `
    ${banner()}
    <section class="hero">
      <div class="card hello">
        <div class="eyebrow">${isToday ? 'Heute' : 'Vorschau'} · ${fmtDay(day)}</div>
        <h1>${esc(greeting(now))}! <span class="gradtext">${headline(units.length, isToday)}</span></h1>
        <p class="muted">${summary(units.length, subs, cancels, extra, isToday)}</p>
        <p class="quote">${esc(quote)}</p>
      </div>
      <div class="card next">
        ${ring(pct, isToday ? `${done}/${units.length}` : units.length, isToday ? 'geschafft' : 'Stunden')}
        ${nextHtml}
      </div>
    </section>

    <section class="stats">
      ${stat(units.length, 'Stunden', 'c-accent')}
      ${stat(subs, subs === 1 ? 'Vertretung/Änderung' : 'Vertretungen/Änderungen', 'c-violet')}
      ${stat(cancels, cancels === 1 ? 'Ausfall' : 'Ausfälle', 'c-red')}
      ${stat(dueSoon, 'HA fällig (7 Tage)', 'c-green')}
    </section>

    <section class="card">
      <h2>Dein Tag</h2>
      ${lessons.length ? `<div class="lessons">${lessons.map(l => lessonRow(l, isToday ? nowMin : null)).join('')}</div>` : '<p class="empty">Keine Stunden.</p>'}
    </section>`;
}
const isTomorrow = (day, now) => day === iso(addDays(now, 1));
function headline(n, isToday) {
  if (!n) return 'Durchatmen.';
  if (n <= 3) return isToday ? 'Entspannter Tag.' : 'Entspannter Tag voraus.';
  if (n <= 5) return isToday ? 'Du rockst das.' : 'Gut machbar.';
  return isToday ? 'Volle Power heute.' : 'Großer Tag voraus.';
}
function summary(n, subs, cancels, extra, isToday) {
  const parts = [`${n} ${n === 1 ? 'Stunde' : 'Stunden'}`];
  if (subs) parts.push(`${subs} geändert`);
  if (cancels) parts.push(`${cancels} fällt aus`);
  if (extra) parts.push(`${extra} Beratung/Aufsicht`);
  return (isToday ? 'Heute: ' : 'Morgen bzw. nächster Schultag: ') + parts.join(' · ');
}

function viewWoche() {
  const now = new Date();
  const mon = addDays(monday(now), weekOffset * 7);
  const days = [0, 1, 2, 3, 4].map(i => iso(addDays(mon, i)));
  const wk = data().lessons.filter(l => l.date >= days[0] && l.date <= days[4]);
  const units = wk.filter(teaching);
  const nowKey = iso(now) + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes());
  const done = units.filter(l => (l.date + ' ' + l.end) <= nowKey).length;
  const pct = units.length ? Math.round(done / units.length * 100) : 0;
  const subs = wk.filter(l => l.status === 'changed').length;
  const cancels = wk.filter(l => l.status === 'cancelled').length;
  const extra = wk.filter(l => l.kind !== 'unterricht').length;
  const kw = isoWeek(mon);

  return `
    ${banner()}
    <div class="weekbar">
      <div><div class="eyebrow">KW ${kw} · ${fmtShort(days[0])} bis ${fmtShort(days[4])}</div>
        <h1 style="margin-top:4px">${weekOffset === 0 ? 'Diese Woche' : 'Nächste Woche'}</h1></div>
      <div class="seg" role="tablist">
        <button class="${weekOffset === 0 ? 'on' : ''}" data-week="0">Diese Woche</button>
        <button class="${weekOffset === 1 ? 'on' : ''}" data-week="1">Nächste Woche</button>
      </div>
    </div>
    <section class="stats">
      ${stat(units.length, 'Stunden', 'c-accent')}
      ${stat(subs, 'Vertretungen/Änderungen', 'c-violet')}
      ${stat(cancels, 'Ausfälle', 'c-red')}
      ${stat(extra, 'Beratung & Aufsicht', 'c-green')}
    </section>
    ${weekOffset === 0 ? `<section class="card" style="margin-bottom:16px">
      <div class="row" style="justify-content:space-between;margin-bottom:10px"><b>Wochenfortschritt</b><span class="muted small">${done} von ${units.length} Stunden · ${pct} %</span></div>
      <div class="progress"><i style="width:${pct}%"></i></div>
      <p class="muted small" style="margin:10px 0 0">${pct >= 100 ? 'Woche geschafft. Wochenende verdient! 🎉' : pct >= 50 ? 'Mehr als die Hälfte ist geschafft. Weiter so!' : 'Die Woche läuft. Eins nach dem anderen.'}</p>
    </section>` : ''}
    <section class="week">
      ${days.map(d => {
        const ls = data().lessons.filter(l => l.date === d);
        return `<div class="card day ${d === iso(now) ? 'today' : ''}">
          <h3><span>${WD[fromIso(d).getDay()]}</span><span class="muted small">${fromIso(d).getDate()}.${fromIso(d).getMonth() + 1}.</span></h3>
          ${ls.length ? `<div class="lessons">${ls.map(l => lessonRow(l, d === iso(now) ? now.getHours() * 60 + now.getMinutes() : null, true)).join('')}</div>` : '<p class="empty">Frei</p>'}
        </div>`;
      }).join('')}
    </section>`;
}

function viewHausaufgaben() {
  const today = iso(new Date());
  const hw = data().homework.filter(h => h.due >= today);
  const past = data().homework.filter(h => h.due < today);
  const groups = new Map();
  for (const h of hw) { if (!groups.has(h.due)) groups.set(h.due, []); groups.get(h.due).push(h); }
  return `
    ${banner()}
    <div class="weekbar"><div><div class="eyebrow">Aus WebUntis</div><h1 style="margin-top:4px">Erteilte Hausaufgaben</h1>
      <p class="muted">${hw.length ? `${hw.length} offen bis Ende nächster Woche` : 'Gerade keine offenen Hausaufgaben.'}</p></div></div>
    <section class="card">
      ${hw.length ? [...groups].map(([due, list]) => `
        <div class="hw-group"><h3>Fällig ${due === today ? 'heute' : fmtDay(due)}</h3>
          ${list.map(hwRow).join('')}
        </div>`).join('') : '<p class="empty">Nichts fällig. Freie Bahn! ✨</p>'}
    </section>
    ${past.length ? `<p class="muted small" style="margin-top:12px">${past.length} ältere Hausaufgaben aus dieser Woche sind ausgeblendet.</p>` : ''}`;
}
function hwRow(h) {
  return `<div class="hw">
    <div><b>${esc(h.subject || 'Fach')}</b> ${(h.classes || []).map(c => `<span class="chip">${esc(c)}</span>`).join('')}</div>
    <span class="muted small">erteilt ${h.assigned ? fmtShort(h.assigned) : '–'}</span>
    <div class="text">${esc(h.text)}</div>
  </div>`;
}

function viewEinstellungen() {
  const st = S.sync;
  return `
    <div class="weekbar"><div><div class="eyebrow">Einrichtung</div><h1 style="margin-top:4px">Einstellungen</h1></div></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
      <section class="card">
        <h2>Du</h2>
        <label class="field">Vorname für die Begrüßung <input id="f-name" autocomplete="given-name" value="${esc(S.settings.name)}"></label>
        <h2 style="margin-top:8px">Abrufdienst</h2>
        <label class="field">Adresse <input id="f-url" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="https://lehrbegleiter-sync.….workers.dev" value="${esc(S.settings.syncUrl)}"></label>
        <label class="field">App-Schlüssel <input id="f-key" type="password" autocomplete="off" value="${esc(S.settings.syncKey)}"></label>
        <div class="row">
          <button class="btn" id="b-save">Speichern & abrufen</button>
          <button class="btn ghost" id="b-sync" ${configured() ? '' : 'disabled'}>${syncing ? '⏳ Lädt …' : '🔄 Jetzt abrufen'}</button>
        </div>
        <p class="muted small" style="margin-top:12px">${statusText()}</p>
        ${st && st.errors && st.errors.length ? `<div class="errors">${st.errors.map(e => `⚠️ ${esc(e.source)}: ${esc(e.message)}`).join('<br>')}</div>` : ''}
      </section>
      <section class="card">
        <h2>Datenschutz</h2>
        <ul class="list muted">
          <li>Die App zeigt nur deinen eigenen Stundenplan und deine erteilten Hausaufgaben.</li>
          <li>Schülerlisten, Klassenbuch, Fehlzeiten und Noten werden nie abgerufen.</li>
          <li>Der Abrufdienst filtert jede Antwort auf wenige Felder und speichert nichts dauerhaft.</li>
          <li>Die Daten liegen nur hier im Browser. „Daten löschen“ entfernt alles.</li>
        </ul>
        <div class="row" style="margin-top:12px"><button class="btn ghost" id="b-clear">🗑️ Daten löschen</button></div>
      </section>
    </div>`;
}

/* ---------- Bausteine ---------- */
function banner() {
  if (isDemo()) return `<div class="banner">✨ <span>Du siehst <b>Demo-Daten</b>. Verbinde den Abrufdienst unter <a href="#einstellungen">Einstellungen</a>, dann erscheint dein echter Stundenplan.</span></div>`;
  if (S.sync.errors && S.sync.errors.length) return `<div class="banner warn">⚠️ <span>Beim letzten Abruf gab es ein Problem. Details unter <a href="#einstellungen">Einstellungen</a>.</span></div>`;
  return '';
}
function stat(n, label, cls) { return `<div class="card stat ${cls}"><div class="n">${n}</div><div class="l">${esc(label)}</div></div>`; }
function ring(pct, big, small) {
  const r = 46, c = 2 * Math.PI * r;
  return `<div class="ring"><svg width="112" height="112" viewBox="0 0 112 112" aria-hidden="true">
      <defs><linearGradient id="ringgrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7a59"/><stop offset="1" stop-color="#ffc247"/></linearGradient></defs>
      <circle class="track" cx="56" cy="56" r="${r}"/>
      <circle class="bar" cx="56" cy="56" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct / 100)}"/>
    </svg><div class="label"><div>${big}<small>${small}</small></div></div></div>`;
}
function lessonTitle(l) {
  const cls = (l.classes || []).join(', ');
  if (l.kind === 'beratung') return 'Beratung' + (l.subject && l.subject !== 'Beratung' ? ' · ' + l.subject : '');
  if (l.kind === 'aufsicht') return 'Pausenaufsicht';
  if (l.kind === 'bereitschaft') return 'Bereitschaft';
  return [cls, l.subject].filter(Boolean).join(' · ');
}
const COLORS = ['#ff7a59', '#8b7bff', '#3ee0a1', '#5cc8ff', '#ffc247', '#ff5d7a', '#c07bff'];
function colorFor(l) {
  if (l.kind === 'beratung') return 'var(--green)';
  if (l.kind !== 'unterricht') return 'var(--blue)';
  const key = (l.short || l.subject || '') + (l.classes || []).join();
  let h = 0; for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}
function lessonRow(l, nowMin, compact = false) {
  const isNow = nowMin !== null && toMin(l.start) <= nowMin && toMin(l.end) > nowMin;
  const isPast = nowMin !== null && toMin(l.end) <= nowMin;
  const badge = l.status === 'cancelled' ? '<span class="badge b-cancelled">Ausfall</span>'
    : l.status === 'changed' ? '<span class="badge b-changed">Änderung</span>'
    : isNow ? '<span class="badge b-now">Jetzt</span>'
    : l.kind !== 'unterricht' ? `<span class="badge b-${l.kind}">${{ beratung: 'Beratung', aufsicht: 'Aufsicht', bereitschaft: 'Bereitschaft', pruefung: 'Prüfung' }[l.kind] || ''}</span>` : '';
  const meta = [l.room && 'Raum ' + l.room, l.info].filter(Boolean).join(' · ');
  return `<div class="lesson ${l.status} ${isNow ? 'now' : ''} ${isPast ? 'past' : ''}" style="--c:${colorFor(l)}">
    <div class="time">${l.start}${compact ? '' : `<small>${l.end}</small>`}</div>
    <div class="what"><div class="subj">${esc(lessonTitle(l))}</div>${meta ? `<div class="meta">${esc(meta)}</div>` : ''}</div>
    ${badge}
  </div>`;
}
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}

/* ---------- Abruf ---------- */
function statusText() {
  if (!configured()) return 'Noch nicht eingerichtet. Bis dahin zeigt die App Demo-Daten.';
  if (!S.sync) return 'Noch nie abgerufen.';
  const d = new Date(S.sync.fetchedAt);
  return `Zuletzt abgerufen: ${d.toLocaleDateString('de-DE')} um ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr · ${S.sync.lessons.length} Stunden, ${S.sync.homework.length} Hausaufgaben`;
}
async function syncNow(force = false, quiet = false) {
  const base = S.settings.syncUrl.trim().replace(/\/+$/, '');
  if (!base || !S.settings.syncKey || syncing) return;
  syncing = true; render();
  try {
    const res = await fetch(base + '/sync' + (force ? '?fresh=1' : ''), { headers: { 'X-App-Key': S.settings.syncKey }, cache: 'no-store' });
    if (res.status === 401) throw new Error('App-Schlüssel passt nicht');
    if (!res.ok) throw new Error('Abrufdienst antwortet mit ' + res.status);
    const d = await res.json();
    S.sync = { fetchedAt: Date.now(), updated: d.updated, lessons: d.lessons || [], homework: d.homework || [], errors: d.errors || [] };
    save();
    if (!quiet) toast(d.errors && d.errors.length ? 'Abgerufen, mit Hinweisen' : 'Alles aktuell ✨');
  } catch (e) {
    if (!quiet) toast('Abruf fehlgeschlagen: ' + (e.message || e));
  } finally { syncing = false; render(); }
}
function autoSync() {
  if (!configured() || !navigator.onLine) return;
  if (!S.sync || Date.now() - S.sync.fetchedAt > AUTO_SYNC_MIN * 60000) syncNow(false, true);
}

/* ---------- Demo-Daten (frei erfunden, keine echten Personen) ---------- */
let demoCache = null;
function demoData() {
  const mon = monday(new Date());
  const key = iso(mon);
  if (demoCache && demoCache.key === key) return demoCache.data;
  const P = [['07:50', '08:35'], ['08:40', '09:25'], ['09:45', '10:30'], ['10:35', '11:20'], ['11:40', '12:25'], ['12:30', '13:15'], ['13:45', '14:30'], ['14:30', '15:15']];
  const GE = ['Geschichte', 'GE'], IF = ['Informatik', 'IF'];
  const plan = [
    [[1, GE, 'Q1', 'A112'], [2, GE, 'Q1', 'A112'], [4, IF, 'EF', 'Info 2'], [6, GE, '6b', 'B014']],
    [[1, IF, 'Q2', 'Info 1'], [2, IF, 'Q2', 'Info 1'], [3, 'aufsicht'], [5, GE, '8c', 'B203'], [7, 'beratung']],
    [[3, GE, 'EF', 'A108'], [4, GE, 'EF', 'A108'], [5, IF, '8a', 'Info 2'], [6, IF, '8a', 'Info 2']],
    [[1, GE, '6b', 'B014'], [3, IF, 'EF', 'Info 2'], [4, IF, 'EF', 'Info 2'], [6, GE, 'Q1', 'A112'], [7, GE, 'Q1', 'A112']],
    [[2, IF, 'Q2', 'Info 1'], [3, GE, '8c', 'B203'], [5, 'beratung']]
  ];
  const lessons = [];
  for (let w = 0; w < 2; w++) {
    plan.forEach((dayPlan, di) => {
      const date = iso(addDays(mon, w * 7 + di));
      for (const [p, s, cls, room] of dayPlan) {
        const [start, end] = P[p - 1];
        if (s === 'aufsicht') lessons.push({ date, start: '09:25', end: '09:45', kind: 'aufsicht', subject: 'Aufsicht', short: '', classes: [], room: 'Hof Nord', status: 'normal', info: '' });
        else if (s === 'beratung') lessons.push({ date, start, end, kind: 'beratung', subject: 'Beratung', short: '', classes: [], room: 'Beratungsraum', status: 'normal', info: '' });
        else lessons.push({ date, start, end, kind: 'unterricht', subject: s[0], short: s[1], classes: [cls], room, status: 'normal', info: '' });
      }
    });
  }
  const tue = iso(addDays(mon, 1)), thu = iso(addDays(mon, 3)), nextWed = iso(addDays(mon, 9));
  lessons.push({ date: tue, start: P[3][0], end: P[3][1], kind: 'unterricht', subject: 'Geschichte', short: 'GE', classes: ['9d'], room: 'B105', status: 'changed', info: 'Vertretung' });
  const c = lessons.find(l => l.date === thu && l.start === P[0][0]); if (c) { c.status = 'cancelled'; c.info = 'Klasse auf Exkursion'; }
  const r = lessons.find(l => l.date === nextWed && l.start === P[2][0]); if (r) { r.status = 'changed'; r.room = 'A201'; r.info = 'Raumänderung'; }
  lessons.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const hw = (dIdx, aIdx, subject, cls, text) => ({ id: 'demo' + dIdx + cls, subject, classes: [cls], text, due: iso(addDays(mon, dIdx)), assigned: iso(addDays(mon, aIdx)) });
  const homework = [
    hw(3, 0, 'Informatik', 'EF', 'Aufgabe 3 und 4 auf dem Arbeitsblatt „Schleifen“ fertig programmieren.'),
    hw(4, 1, 'Geschichte', '8c', 'Quelle S. 112 lesen und drei Fragen an den Text formulieren.'),
    hw(7, 3, 'Geschichte', 'Q1', 'Referat-Gliederung zur Weimarer Verfassung mitbringen.'),
    hw(9, 2, 'Informatik', '8a', 'Eigenes Scratch-Spiel um ein Level erweitern.'),
    hw(10, 3, 'Geschichte', '6b', 'Zeitstrahl Antike sauber ins Heft übertragen.')
  ].sort((a, b) => a.due.localeCompare(b.due));
  demoCache = { key, data: { lessons, homework, errors: [] } };
  return demoCache.data;
}

/* ---------- Rahmen ---------- */
const VIEWS = { heute: viewHeute, woche: viewWoche, hausaufgaben: viewHausaufgaben, einstellungen: viewEinstellungen };
function route() { const h = location.hash.slice(1); return VIEWS[h] ? h : 'heute'; }
function render() {
  const r = route();
  const active = document.activeElement && document.activeElement.id;
  document.getElementById('view').innerHTML = VIEWS[r]();
  document.querySelectorAll('[data-tab]').forEach(a => a.classList.toggle('on', a.dataset.tab === r));
  if (active && document.getElementById(active) && active.startsWith('f-')) document.getElementById(active).focus();
}
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2800);
}

document.addEventListener('click', e => {
  const wk = e.target.closest('[data-week]');
  if (wk) { weekOffset = Number(wk.dataset.week); render(); return; }
  const id = e.target.closest('button') && e.target.closest('button').id;
  if (id === 'b-save') {
    S.settings.name = document.getElementById('f-name').value.trim();
    S.settings.syncUrl = document.getElementById('f-url').value.trim();
    S.settings.syncKey = document.getElementById('f-key').value.trim();
    save();
    if (configured()) syncNow(true); else { toast('Gespeichert'); render(); }
  } else if (id === 'b-sync') syncNow(true);
  else if (id === 'b-clear') {
    if (confirm('Alle Daten und Einstellungen dieser App auf diesem Gerät löschen?')) {
      try { localStorage.removeItem(STORE); } catch { /* egal */ }
      S = structuredClone(DEFAULT); render(); toast('Gelöscht');
    }
  }
});
window.addEventListener('hashchange', () => { render(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { autoSync(); render(); } });
setInterval(() => { if (!document.hidden && route() !== 'einstellungen') render(); }, 60000);

render();
autoSync();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
