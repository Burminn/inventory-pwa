// Zapis sesji do JSON (wymiana między telefonami, kopia zapasowa), walidacja i scalanie.
// Plik JSON może pochodzić z innego urządzenia, więc jest traktowany jak dane niezaufane.

import { ROLES, MAX_NUMBER, createSession, norm, rowKey, cell } from './model.js';
import { validateMapping } from './mapping.js';

export const FORMAT = 'inwentaryzacja-pwa';
export const VERSION = 1;
export const LIMITS = { bytes: 40 * 1024 * 1024, rows: 200000, cols: 200, text: 500 };

export function serialize(s, now = new Date()) {
  const mapObj = (m) => Object.fromEntries([...m].map(([n, e]) => [n, { v: e.v, t: e.t, d: e.d }]));
  return {
    format: FORMAT, version: VERSION, savedAt: now.toISOString(),
    name: s.name, sourceId: s.sourceId, headers: s.headers, rows: s.rows, mapping: s.mapping, cur: s.cur,
    counts: [...s.counts].map(([k, m]) => [k, mapObj(m)]),
    totals: [...s.totals].map(([k, m]) => [k, mapObj(m)]),
  };
}

const fail = (msg) => { throw new Error('Nieprawidłowy plik sesji: ' + msg); };
const str = (x, max = LIMITS.text) => (typeof x === 'string' ? x.slice(0, max) : x == null ? '' : String(x).slice(0, max));

function cleanEntries(obj, where) {
  const out = new Map();
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) fail(where);
  for (const n of [1, 2]) {
    const e = Object.prototype.hasOwnProperty.call(obj, n) ? obj[n] : undefined;
    if (e === undefined) continue;
    if (!e || typeof e !== 'object' || typeof e.v !== 'number' || !Number.isFinite(e.v) || e.v < 0 || e.v > MAX_NUMBER) fail(where + ': zła ilość');
    const t = str(e.t, 40);
    out.set(n, { v: e.v, t: Number.isNaN(Date.parse(t)) ? new Date(0).toISOString() : new Date(t).toISOString(), d: str(e.d, 80) });
  }
  return out;
}

/** Waliduje obiekt z JSON-a i buduje z niego czystą sesję (kopiuje tylko znane pola). */
export function deserialize(obj) {
  if (!obj || typeof obj !== 'object' || obj.format !== FORMAT) fail('to nie jest plik z tej aplikacji');
  if (obj.version !== VERSION) fail('nieobsługiwana wersja ' + obj.version);
  if (!Array.isArray(obj.headers) || obj.headers.length === 0 || obj.headers.length > LIMITS.cols) fail('nagłówki');
  if (!Array.isArray(obj.rows) || obj.rows.length > LIMITS.rows) fail('wiersze');
  const headers = obj.headers.map((h) => str(h));
  const rows = obj.rows.map((r) => {
    if (!Array.isArray(r) || r.length > LIMITS.cols) fail('wiersz');
    return r.map((c) => str(c));
  });
  const mapping = Object.fromEntries(ROLES.map((r) => [r, Object.prototype.hasOwnProperty.call(obj.mapping || {}, r) ? obj.mapping[r] : null]));
  const errors = validateMapping(mapping, headers.length);
  if (errors.length) fail(errors[0]);
  const s = createSession({ name: str(obj.name, 120), headers, rows, mapping, sourceId: str(obj.sourceId, 32) });
  s.cur = obj.cur === 2 ? 2 : 1;
  if (!Array.isArray(obj.counts) || !Array.isArray(obj.totals)) fail('liczenia');
  for (const item of obj.counts) {
    if (!Array.isArray(item) || typeof item[0] !== 'string') fail('liczenia');
    const m = cleanEntries(item[1], 'liczenia');
    if (m.size) s.counts.set(str(item[0], 1000), m);
  }
  for (const item of obj.totals) {
    if (!Array.isArray(item) || typeof item[0] !== 'string') fail('sumy');
    const m = cleanEntries(item[1], 'sumy');
    if (m.size) s.totals.set(str(item[0], 1000), m);
  }
  return s;
}

export function parseJson(text) {
  if (typeof text !== 'string' || text.length > LIMITS.bytes) fail('plik za duży');
  let obj;
  try { obj = JSON.parse(text); } catch { fail('uszkodzony JSON'); }
  return deserialize(obj);
}

/**
 * Dokłada do `local` to, czego mu brakuje z `incoming`; wpisów lokalnych NIGDY nie nadpisuje
 * (rozbieżne wartości są tylko zliczane jako konflikty).
 */
export function merge(local, incoming) {
  const res = { added: 0, newRows: 0, conflicts: 0, sameSource: local.sourceId === incoming.sourceId };
  const index = new Map();
  for (let r = 0; r < local.rows.length; r++) index.set(rowKey(local, r), r);
  const W = local.headers.length;
  for (let r = 0; r < incoming.rows.length; r++) {
    const k = rowKey(incoming, r);
    if (k === '|' || index.has(k)) continue;
    const row = new Array(W).fill('');
    for (const role of ROLES) {
      const lc = local.mapping[role];
      if (lc != null) row[lc] = cell(incoming, r, role);
    }
    local.rows.push(row);
    index.set(rowKey(local, local.rows.length - 1), local.rows.length - 1);
    res.newRows++;
  }
  const put = (target, key, m) => {
    for (const [n, e] of m) {
      if (!target.has(key)) target.set(key, new Map());
      const cur = target.get(key).get(n);
      if (!cur) { target.get(key).set(n, { ...e }); res.added++; }
      else if (cur.v !== e.v) res.conflicts++;
    }
  };
  for (const [k, m] of incoming.counts) if (index.has(k)) put(local.counts, k, m);
  for (const [k, m] of incoming.totals) put(local.totals, k, m);
  local.rev++;
  local._cache = null;
  return res;
}
