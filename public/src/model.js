// Model inwentury: czysta logika bez DOM-u (testowana w Node).
// Wszystkie słowniki o kluczach pochodzących z danych użytkownika to Map — nigdy zwykły obiekt,
// bo klucz typu "__proto__" w pliku zatruwałby Object.prototype (błąd z pierwszej wersji prototypu).

export const ROLES = ['code', 'item', 'name', 'qty', 'type'];
export const MAX_NUMBER = 1e9;

export const norm = (x) => String(x == null ? '' : x).trim();
export const stripZeros = (x) => norm(x).replace(/^0+/, '');

export function parseNumber(x) {
  const s = norm(x).replace(/\s/g, '').replace(',', '.');
  if (s === '' || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && Math.abs(n) <= MAX_NUMBER ? n : null;
}

export function createSession({ name, headers, rows, mapping, sourceId }) {
  return {
    name: norm(name) || 'inwentura',
    headers: headers.map(norm),
    rows: rows.map((r) => r.map(norm)),
    mapping: { ...mapping },
    sourceId: sourceId || computeSourceId(headers, rows.length),
    counts: new Map(),   // klucz wiersza -> Map(numer liczenia -> {v,t,d})
    totals: new Map(),   // indeks -> Map(numer liczenia -> {v,t,d}) (suma wpisana ręcznie)
    cur: 1,
    rev: 0,
    _cache: null,
  };
}

export function computeSourceId(headers, rowCount) {
  let h = 0x811c9dc5;
  const s = headers.map(norm).join('\u0001') + '\u0002' + rowCount;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const touch = (s) => { s.rev++; s._cache = null; };

export function cell(s, r, role) {
  const c = s.mapping[role];
  if (c == null) return '';
  const row = s.rows[r];
  return row && row[c] != null ? row[c] : '';
}

export const rowKey = (s, r) => cell(s, r, 'code') + '|' + cell(s, r, 'item');
export const systemQty = (s, r) => parseNumber(cell(s, r, 'qty'));

export function rowsAll(s) {
  if (!s._cache) s._cache = {};
  if (!s._cache.rows) {
    const out = [];
    for (let r = 0; r < s.rows.length; r++) if (cell(s, r, 'item') || cell(s, r, 'code')) out.push(r);
    s._cache.rows = out;
  }
  return s._cache.rows;
}

export function entry(s, r, n) {
  const e = s.counts.get(rowKey(s, r));
  return (e && e.get(n)) || null;
}
export const countOf = (s, r, n) => { const e = entry(s, r, n); return e ? e.v : null; };

function checkValue(v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > MAX_NUMBER) {
    throw new RangeError('Ilość musi być liczbą od 0 do ' + MAX_NUMBER);
  }
}

export function setCount(s, r, n, v, dev, when = new Date()) {
  checkValue(v);
  const k = rowKey(s, r);
  if (!s.counts.has(k)) s.counts.set(k, new Map());
  s.counts.get(k).set(n, { v, t: when.toISOString(), d: norm(dev) });
  touch(s);
}

export function setTotal(s, item, n, v, dev, when = new Date()) {
  checkValue(v);
  if (!s.totals.has(item)) s.totals.set(item, new Map());
  s.totals.get(item).set(n, { v, t: when.toISOString(), d: norm(dev) });
  touch(s);
}

export function clearTotal(s, item, n) {
  const m = s.totals.get(item);
  if (m) { m.delete(n); touch(s); }
}

/** Wynik końcowy pozycji: gdy oba liczenia zgodne albo jest tylko jedno; przy rozbieżności null. */
export function finalCount(s, r) {
  const a = countOf(s, r, 1), b = countOf(s, r, 2);
  if (a !== null && b !== null) return a === b ? a : null;
  return a !== null ? a : b;
}

export function rowStatus(s, r) {
  const e1 = entry(s, r, 1), e2 = entry(s, r, 2);
  if (e1 && e2) return e1.v === e2.v ? 'Zgodne L1=L2' : 'RÓŻNICA L1≠L2';
  if (e1) return 'Tylko L1';
  if (e2) return 'Tylko L2';
  return 'Nie policzono';
}

/** Grupowanie po indeksie: suma systemowa, suma z pozycji (auto), suma wpisana ręcznie. */
export function byItem(s, n) {
  if (!s._cache) s._cache = {};
  const ck = 'item' + n;
  if (s._cache[ck]) return s._cache[ck];
  const m = new Map();
  for (const r of rowsAll(s)) {
    const item = cell(s, r, 'item');
    if (!item) continue;
    let g = m.get(item);
    if (!g) { g = { item, name: cell(s, r, 'name'), rows: [], sys: 0, auto: null, man: null, sum: null }; m.set(item, g); }
    g.rows.push(r);
    g.sys += systemQty(s, r) || 0;
    const c = countOf(s, r, n);
    if (c !== null) g.auto = (g.auto || 0) + c;
  }
  for (const g of m.values()) {
    const t = s.totals.get(g.item);
    const e = t && t.get(n);
    g.man = e ? e.v : null;
    g.sum = g.man !== null ? g.man : g.auto;
  }
  s._cache[ck] = m;
  return m;
}

export const isDiff = (sys, c) => c !== null && c !== (sys || 0);

/** Dodaje ręcznie pozycję spoza arkusza; zwraca jej numer wiersza. */
export function addRow(s, { code, item, name }) {
  const row = new Array(s.headers.length).fill('');
  const put = (role, v) => { const c = s.mapping[role]; if (c != null) row[c] = norm(v).slice(0, 500); };
  put('code', code); put('item', item); put('name', name);
  s.rows.push(row);
  touch(s);
  return s.rows.length - 1;
}

/** Szukanie: dokładny kod (także bez zer wiodących) -> indeks -> fragmenty nazwy. */
export function search(s, query) {
  const q = norm(query);
  if (!q) return { kind: 'none' };
  const z = stripZeros(q), up = q.toUpperCase();
  const rs = rowsAll(s);
  const hit = rs.filter((r) => { const k = cell(s, r, 'code'); return k && (k.toUpperCase() === up || (z && stripZeros(k).toUpperCase() === z.toUpperCase())); });
  if (hit.length === 1) return { kind: 'row', row: hit[0] };
  if (hit.length > 1) return { kind: 'pick', rows: hit, title: `Kod ${q} ma kilka pozycji — wybierz indeks:` };
  const g = byItem(s, s.cur);
  if (g.has(up)) return { kind: 'item', item: up };
  if (g.has(q)) return { kind: 'item', item: q };
  const words = up.split(/\s+/);
  const found = rs.filter((r) => {
    const t = (cell(s, r, 'item') + ' ' + cell(s, r, 'name')).toUpperCase();
    return words.every((w) => t.includes(w));
  });
  if (found.length) return { kind: 'pick', rows: found.slice(0, 40), total: found.length, title: `Znaleziono ${found.length} pozycji:` };
  return { kind: 'none', query: q };
}

export function progress(s, mode) {
  if (mode === 'n') {
    const rs = rowsAll(s);
    return { done: rs.filter((r) => countOf(s, r, s.cur) !== null).length, total: rs.length, unit: 'pozycji' };
  }
  const g = [...byItem(s, s.cur).values()];
  return { done: g.filter((x) => x.sum !== null).length, total: g.length, unit: 'indeksów' };
}

export function fmtTime(iso, locale = 'pl-PL') {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(locale);
}

/** Tablica do eksportu: oryginalne kolumny + wyniki liczeń; druga tablica: sumy indeksów. */
export function exportTables(s) {
  const extra = ['Liczenie 1 ilość', 'Liczenie 1 telefon', 'Liczenie 1 czas', 'Liczenie 2 ilość', 'Liczenie 2 telefon',
    'Liczenie 2 czas', 'Stan policzony (wynik)', 'Status', 'Różnica do systemu'];
  const W = s.headers.length;
  const qc = s.mapping.qty;
  const data = [s.headers.concat(extra)];
  const live = new Set(rowsAll(s));
  s.rows.forEach((src, r) => {
    const o = src.slice();
    while (o.length < W) o.push('');
    if (!live.has(r)) { data.push(o.concat(new Array(extra.length).fill(''))); return; }
    if (qc != null) { const q = parseNumber(o[qc]); if (q !== null) o[qc] = q; }
    const e1 = entry(s, r, 1), e2 = entry(s, r, 2), f = finalCount(s, r), sy = systemQty(s, r);
    data.push(o.concat([
      e1 ? e1.v : '', e1 ? e1.d : '', e1 ? fmtTime(e1.t) : '',
      e2 ? e2.v : '', e2 ? e2.d : '', e2 ? fmtTime(e2.t) : '',
      f === null ? '' : f, rowStatus(s, r), f === null ? '' : f - (sy || 0),
    ]));
  });
  const g1 = byItem(s, 1), g2 = byItem(s, 2);
  const z = (v) => (v === null ? '' : v);
  const sums = [['Indeks', 'Nazwa', 'System razem', 'L1 ręcznie', 'L1 auto', 'L2 ręcznie', 'L2 auto', 'L1 razem', 'L2 razem', 'Status']];
  for (const [k, a] of g1) {
    const b = g2.get(k), st = [];
    if (a.sum !== null && b.sum !== null && a.sum !== b.sum) st.push('ROZBIEŻNOŚĆ L1/L2');
    if (a.man !== null && a.auto !== null && a.man !== a.auto) st.push('L1: ręczna≠auto');
    if (b.man !== null && b.auto !== null && b.man !== b.auto) st.push('L2: ręczna≠auto');
    sums.push([a.item, a.name, a.sys, z(a.man), z(a.auto), z(b.man), z(b.auto), z(a.sum), z(b.sum), st.join('; ')]);
  }
  return { data, sums };
}
