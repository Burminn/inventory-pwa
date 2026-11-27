// Interfejs. Dane użytkownika trafiają do DOM wyłącznie przez textContent (nigdy innerHTML).

import * as M from './model.js';
import * as P from './mapping.js';
import * as S from './session.js';
import * as T from './tableio.js';
import * as store from './storage.js';

const $ = (id) => document.getElementById(id);
const PAGE = 80;

let s = null;              // bieżąca sesja
let dev = '';              // nazwa telefonu / osoby liczącej
let mode = 'n', filt = 'all', limit = PAGE;
let stream = null, timer = null;

// ------------------------------------------------------------------ DOM ---
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
const clear = (el) => { el.replaceChildren(); return el; };
const show = (el, on = true) => el.classList.toggle('hidden', !on);

function say(text, isErr = false) {
  const el = $('msg');
  el.textContent = text;
  el.classList.toggle('err', isErr);
  show(el, !!text);
}

// ------------------------------------------------------------- zapis ---
// Arkusz (duży, rzadko się zmienia) i liczenia (małe, zmieniają się przy każdym wpisie) są zapisywane osobno,
// a zapis liczeń rusza natychmiast — bez opóźnienia, żeby zamknięcie karty nie gubiło ostatnich wpisów.
let rowsDirty = false, chain = Promise.resolve();
function save(rowsChanged = false) {
  if (rowsChanged) rowsDirty = true;
  chain = chain.then(persist).catch(() => {});
  return chain;
}
async function persist() {
  if (!s) return;
  const { cur, counts, totals, ...sheet } = S.serialize(s);
  let ok = true;
  if (rowsDirty) { rowsDirty = false; ok = await store.set('sheet', sheet); }
  ok = (await store.set('state', { cur, counts, totals })) && ok;
  if (!ok) say('Brak miejsca na autozapis — zapisz Excel/sesję jak najszybciej.', true);
}
async function restore() {
  const sheet = await store.get('sheet'), state = await store.get('state');
  if (!sheet) return null;
  return S.deserialize({ ...sheet, ...(state || { cur: 1, counts: [], totals: [] }) });
}

// --------------------------------------------------------------- widok ---
function renderTop() {
  $('c1').className = s && s.cur === 1 ? 'on' : '';
  $('c2').className = s && s.cur === 2 ? 'on' : '';
  $('dev').textContent = 'Telefon: ' + (dev || '?');
  if (!s) { $('info').textContent = 'Wczytaj arkusz z danymi (dowolne kolumny — w następnym kroku wskażesz, co oznaczają).'; $('prog').style.width = '0'; return; }
  const p = M.progress(s, mode);
  $('prog').style.width = (100 * p.done / (p.total || 1)) + '%';
  $('info').textContent = `${s.name} · liczenie ${s.cur}: ${p.done} z ${p.total} ${p.unit}`;
}

function renderList() {
  const list = clear($('list'));
  $('mn').className = mode === 'n' ? 'on' : ''; $('mi').className = mode === 'i' ? 'on' : '';
  for (const f of ['all', 'todo', 'dif', 'cmp']) $(f).className = filt === f ? 'on' : '';
  let shown = 0, more = false;
  const add = (node) => { if (shown >= limit) { more = true; return false; } list.append(node); shown++; return true; };
  if (mode === 'n') {
    for (const r of M.rowsAll(s)) {
      const c = M.countOf(s, r, s.cur), d = M.isDiff(M.systemQty(s, r), c);
      const x = M.countOf(s, r, 1), y = M.countOf(s, r, 2), cmpd = x !== null && y !== null && x !== y;
      if ((filt === 'todo' && c !== null) || (filt === 'dif' && !d) || (filt === 'cmp' && !cmpd)) continue;
      const code = M.cell(s, r, 'code');
      if (!add(h('div', { class: 'it', onclick: () => itemView(r) },
        h('b', {}, M.cell(s, r, 'item')), ' ', h('span', { class: 'mu' }, code), h('br'),
        M.cell(s, r, 'name'), h('br'),
        'System: ', M.cell(s, r, 'qty') || '—', ' · Policzono: ',
        h('b', { class: d ? 'diff' : c !== null ? 'okc' : '' }, c === null ? '—' : c),
        filt === 'cmp' ? h('span', { class: 'diff' }, ` · L1: ${x} · L2: ${y}`) : null))) break;
    }
  } else {
    const g = M.byItem(s, s.cur), g1 = M.byItem(s, 1), g2 = M.byItem(s, 2);
    for (const [k, q] of g) {
      const dd = M.isDiff(q.sys, q.sum), s1 = g1.get(k).sum, s2 = g2.get(k).sum, cmpd = s1 !== null && s2 !== null && s1 !== s2;
      if ((filt === 'todo' && q.sum !== null) || (filt === 'dif' && !dd) || (filt === 'cmp' && !cmpd)) continue;
      if (!add(h('div', { class: 'it', onclick: () => idxView(k) },
        h('b', {}, q.item), h('br'), q.name, h('br'),
        `System razem: ${q.sys} · z pozycji: ${q.auto === null ? '—' : q.auto} · Policzono: `,
        h('b', { class: dd ? 'diff' : q.sum !== null ? 'okc' : '' }, q.sum === null ? '—' : q.sum),
        filt === 'cmp' ? h('span', { class: 'diff' }, ` · L1: ${s1} · L2: ${s2}`) : null))) break;
    }
  }
  if (!shown) list.append(h('p', { class: 'mu' }, 'Brak pozycji.'));
  if (more) list.append(h('button', { onclick: () => { limit += PAGE; renderList(); } }, 'Pokaż więcej'));
}

function render() { renderTop(); if (s) renderList(); }

function closePanel() { clear($('pn')); $('code').value = ''; stopCam(); render(); }

function card(...kids) { return h('div', { class: 'card' }, ...kids); }

function pickView(rows, title) {
  stopCam();
  const c = card(h('b', {}, title));
  for (const r of rows) {
    c.append(h('div', { class: 'it', onclick: () => itemView(r) },
      h('b', {}, M.cell(s, r, 'item')), ' ', h('span', { class: 'mu' }, M.cell(s, r, 'code')), h('br'),
      M.cell(s, r, 'name'), h('br'), 'System: ', M.cell(s, r, 'qty') || '—'));
  }
  c.append(h('div', { class: 'row' }, h('button', { onclick: closePanel }, 'Zamknij')));
  clear($('pn')).append(c);
}

function numberInput(placeholder, value) {
  return h('input', { type: 'number', inputmode: 'decimal', step: 'any', min: '0', placeholder, value: value == null ? '' : String(value) });
}

function commitNumber(input, apply) {
  const raw = input.value.trim();
  if (raw === '') { say('Wpisz ilość (0, jeśli pusto).', true); return; }
  const v = M.parseNumber(raw);
  if (v === null || v < 0) { say('Ilość musi być liczbą od 0 do ' + M.MAX_NUMBER + '.', true); return; }
  say('');
  apply(v);
  save();
  closePanel();
}

function itemView(r) {
  stopCam();
  const item = M.cell(s, r, 'item'), g = M.byItem(s, s.cur).get(item), cur = M.countOf(s, r, s.cur), sy = M.systemQty(s, r);
  const input = numberInput('Policzona ilość', cur);
  const sv = () => commitNumber(input, (v) => M.setCount(s, r, s.cur, v, dev));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sv(); });
  clear($('pn')).append(card(
    h('div', { class: 'mu' }, `Liczenie ${s.cur} · ${M.cell(s, r, 'code') || '(bez kodu)'}${M.cell(s, r, 'type') ? ' · ' + M.cell(s, r, 'type') : ''}`),
    h('div', { class: 'big' }, item || M.cell(s, r, 'code')),
    h('div', {}, M.cell(s, r, 'name')),
    h('p', {}, 'W systemie: ', h('b', {}, M.cell(s, r, 'qty') || '—'), h('br'),
      h('span', { class: 'mu' }, 'Razem indeks w systemie: ' + (g ? g.sys : '—'))),
    input,
    sy !== null ? h('div', { class: 'row' }, h('button', { class: 'p', onclick: () => { M.setCount(s, r, s.cur, sy, dev); save(); closePanel(); } }, `✔ Zgodny ze stanem (${sy})`)) : null,
    h('div', { class: 'row' }, h('button', { onclick: closePanel }, 'Anuluj'), h('button', { class: 'g', onclick: sv }, 'Zatwierdź'))));
  input.focus();
}

function idxView(item) {
  stopCam();
  const g = M.byItem(s, s.cur).get(item);
  if (!g) { closePanel(); return; }
  const t = s.totals.get(item) && s.totals.get(item).get(s.cur);
  const input = numberInput('Razem policzono (cały indeks)', t ? t.v : null);
  const sv = () => commitNumber(input, (v) => M.setTotal(s, item, s.cur, v, dev));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sv(); });
  clear($('pn')).append(card(
    h('div', { class: 'mu' }, 'Liczenie ' + s.cur), h('div', { class: 'big' }, item), h('div', {}, g.name),
    h('p', {}, 'Razem w systemie: ', h('b', {}, g.sys), ` (${g.rows.length} poz.)`, h('br'),
      'Suma z pozycji (kontrola): ', h('b', {}, g.auto === null ? '—' : g.auto),
      g.man !== null && g.auto !== null && g.man !== g.auto ? h('span', { class: 'diff' }, ' ≠ wpisana ręcznie') : null),
    input,
    h('div', { class: 'row' }, h('button', { onclick: closePanel }, 'Anuluj'),
      h('button', { onclick: () => { M.clearTotal(s, item, s.cur); save(); closePanel(); } }, 'Usuń sumę'),
      h('button', { class: 'g', onclick: sv }, 'Zatwierdź'))));
}

function doSearch(q) {
  if (!s) return;
  const res = M.search(s, q);
  if (res.kind === 'row') return itemView(res.row);
  if (res.kind === 'item') return idxView(res.item);
  if (res.kind === 'pick') return pickView(res.rows, res.title);
  if (!String(q).trim()) return;
  const query = res.query;
  clear($('pn')).append(card(`Nie znaleziono „${query}”.`,
    h('div', { class: 'row' },
      h('button', { class: 'p', onclick: () => addCarrier(query) }, 'Dodaj jako nową pozycję'),
      h('button', { onclick: closePanel }, 'Zamknij'))));
}

function addCarrier(code) {
  if (s.mapping.code == null && s.mapping.item == null) return;
  const ix = prompt('Indeks nowej pozycji (np. A-100):', '');
  if (ix === null) return;
  const item = M.norm(ix).toUpperCase();
  const known = M.byItem(s, s.cur).get(item);
  const r = M.addRow(s, { code: s.mapping.code != null ? code : '', item: item || code, name: known ? known.name : '(spoza listy)' });
  save(true);
  itemView(r);
}

// ---------------------------------------------------------- skanowanie ---
async function startCam() {
  if (!('BarcodeDetector' in window)) { say('Ta przeglądarka nie obsługuje skanowania kamerą. Wpisz kod ręcznie albo użyj skanera w trybie klawiatury.', true); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const v = $('vid');
    v.srcObject = stream; show(v); await v.play();
    const det = new BarcodeDetector();
    timer = setInterval(async () => {
      try {
        const b = await det.detect(v);
        if (b.length) { if (navigator.vibrate) navigator.vibrate(80); const val = b[0].rawValue; $('code').value = val; stopCam(); doSearch(val); }
      } catch { /* pojedyncza klatka bez kodu */ }
    }, 300);
  } catch (e) {
    stopCam();
    if (confirm('Brak dostępu do kamery na żywo (' + e.message + '). Zrobić zdjęcie kodu zamiast tego?')) $('ph').click();
  }
}
function stopCam() {
  clearInterval(timer); timer = null;
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  const v = $('vid'); v.srcObject = null; show(v, false);
}

// --------------------------------------------------- wczytanie + mapowanie ---
let pending = null;  // {name, buffer, sheetIdx, table, headerRow, mapping}

async function readFile(file) {
  if (!file) return;
  say('Wczytuję…');
  try {
    const buffer = await file.arrayBuffer();
    pending = { name: file.name, buffer, sheetIdx: 0, headerRow: 0 };
    await loadPendingTable();
  } catch (e) { pending = null; say('Błąd odczytu: ' + e.message, true); }
}

async function loadPendingTable() {
  const t = await T.readTable({ name: pending.name, buffer: pending.buffer }, pending.sheetIdx);
  if (t.aoa.length < 2) throw new Error('Plik nie zawiera danych (potrzebny wiersz nagłówków i co najmniej jeden wiersz).');
  pending.table = t;
  pending.headerRow = P.detectHeaderRow(t.aoa);
  await prepareMapping();
}

async function prepareMapping() {
  const headers = headersOf();
  const saved = (await store.get('mappings')) || [];
  const sig = P.headerSignature(headers);
  const hit = Array.isArray(saved) ? saved.find((x) => x && x.sig === sig) : null;
  pending.mapping = hit ? P.sanitizeMapping(hit.mapping, headers.length) : P.suggestMapping(headers);
  pending.fromMemory = !!hit;
  say('');
  renderMapping();
}

function headersOf() {
  const w = Math.max(...pending.table.aoa.slice(pending.headerRow).map((r) => r.length));
  const hdr = pending.table.aoa[pending.headerRow] || [];
  return Array.from({ length: w }, (_, i) => M.norm(hdr[i]) || `(kolumna ${i + 1})`);
}

function renderMapping() {
  const box = clear($('mapping')); show(box);
  const { table } = pending, headers = headersOf();
  const pv = h('table', { class: 'pv' }, h('tr', {}, headers.map((x) => h('th', {}, x))));
  for (const r of table.aoa.slice(pending.headerRow + 1, pending.headerRow + 5)) pv.append(h('tr', {}, headers.map((_, i) => h('td', {}, r[i] || ''))));
  box.append(h('b', {}, 'Co oznaczają kolumny?'),
    h('p', { class: 'mu' }, `Plik: ${pending.name}` + (pending.fromMemory ? ' · przywrócono zapamiętane mapowanie dla tego układu kolumn' : ' · podpowiedź na podstawie nagłówków — sprawdź')),
    pv);
  if (table.sheetNames.length > 1) {
    box.append(h('label', { class: 'f' }, 'Arkusz',
      h('select', { onchange: async (e) => { pending.sheetIdx = Number(e.target.value); try { await loadPendingTable(); } catch (err) { say(err.message, true); } } },
        table.sheetNames.map((n, i) => h('option', { value: String(i), selected: i === pending.sheetIdx }, n)))));
  }
  box.append(h('label', { class: 'f' }, 'Wiersz z nagłówkami',
    h('select', { onchange: async (e) => { pending.headerRow = Number(e.target.value); await prepareMapping(); } },
      table.aoa.slice(0, 30).map((r, i) => h('option', { value: String(i), selected: i === pending.headerRow }, `${i + 1}: ${r.filter((c) => c).slice(0, 3).join(' | ').slice(0, 40)}`)))));
  for (const role of M.ROLES) {
    box.append(h('label', { class: 'f' }, P.ROLE_LABELS[role],
      h('select', { onchange: (e) => { pending.mapping[role] = e.target.value === '' ? null : Number(e.target.value); } },
        h('option', { value: '' }, '— brak —'),
        headers.map((x, i) => h('option', { value: String(i), selected: pending.mapping[role] === i }, `${i + 1}. ${x}`)))));
  }
  box.append(h('div', { class: 'row' }, h('button', { onclick: cancelMapping }, 'Anuluj'), h('button', { class: 'g', onclick: confirmMapping }, 'Rozpocznij inwenturę')));
}

function cancelMapping() { pending = null; show($('mapping'), false); say(''); }

async function confirmMapping() {
  const headers = headersOf();
  const errors = P.validateMapping(pending.mapping, headers.length);
  if (errors.length) { say(errors.join('\n'), true); return; }
  const rows = pending.table.aoa.slice(pending.headerRow + 1).map((r) => headers.map((_, i) => r[i] || ''));
  const name = pending.name.replace(/\.[^.]+$/, '');
  const saved = (await store.get('mappings')) || [];
  const sig = P.headerSignature(headers);
  const next = [{ sig, mapping: pending.mapping }, ...(Array.isArray(saved) ? saved.filter((x) => x && x.sig !== sig) : [])].slice(0, 30);
  await store.set('mappings', next);
  s = M.createSession({ name, headers, rows, mapping: pending.mapping });
  pending = null; show($('mapping'), false);
  await save(true);
  say(`Wczytano ${s.rows.length} wierszy.`);
  show($('work')); render();
  store.requestPersistence();
}

// ------------------------------------------------- scalanie z innym tel. ---
async function importSession(file) {
  if (!file) return;
  try {
    if (!s) throw new Error('Najpierw wczytaj arkusz (ten sam, z którego korzysta drugi telefon).');
    if (file.size > S.LIMITS.bytes) throw new Error('Plik jest za duży.');
    const incoming = S.parseJson(await file.text());
    if (incoming.sourceId !== s.sourceId && !confirm('Ten plik pochodzi z innego arkusza (inne nagłówki lub liczba wierszy). Scalić mimo to? Pasujące pozycje zostaną dopasowane po kodzie i indeksie.')) return;
    const r = S.merge(s, incoming);
    save(true); render();
    say(`Dodano wpisów: ${r.added}\nNowe pozycje: ${r.newRows}\nKonflikty (zostawiono Twoje): ${r.conflicts}\n\nFiltr „L1≠L2” pokaże rozbieżności między liczeniami.`);
  } catch (e) { say(e.message, true); }
}

// ---------------------------------------------------------------- eksport ---
const baseName = () => s.name.replace(/_telefon_.*$/, '') + '_telefon_' + ((dev || 'x').replace(/[^\w-]/g, '') || 'x');

async function deliver(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function exportXlsx() {
  try {
    const { data, sums } = M.exportTables(s);
    const buf = await T.writeXlsx([{ name: s.name.slice(0, 31), aoa: data }, { name: 'Sumy indeksów', aoa: sums }]);
    await deliver(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), baseName() + '.xlsx');
  } catch (e) { say('Błąd zapisu: ' + e.message, true); }
}
async function exportCsv() {
  try { await deliver(new Blob([T.toCsv(M.exportTables(s).data)], { type: 'text/csv;charset=utf-8' }), baseName() + '.csv'); }
  catch (e) { say('Błąd zapisu: ' + e.message, true); }
}
async function exportSession() {
  try { await deliver(new Blob([JSON.stringify(S.serialize(s))], { type: 'application/json' }), baseName() + '.inwent.json'); }
  catch (e) { say('Błąd zapisu: ' + e.message, true); }
}

// ------------------------------------------------------------------ start ---
async function askDev() {
  const v = prompt('Nazwa tego telefonu / osoby liczącej (np. Adam):', dev || '');
  if (v === null) return;
  dev = M.norm(v).slice(0, 80);
  await store.set('device', dev);
  renderTop();
}

function bind() {
  $('load').onclick = () => $('file').click();
  $('file').onchange = (e) => { readFile(e.target.files[0]); e.target.value = ''; };
  $('imp').onclick = () => { if (!s) { say('Najpierw wczytaj arkusz.', true); return; } $('file2').click(); };
  $('file2').onchange = (e) => { importSession(e.target.files[0]); e.target.value = ''; };
  $('clear').onclick = async () => {
    if (!confirm('Usunąć wczytane dane i wyniki z tego telefonu? (zapamiętane mapowania zostaną)')) return;
    await Promise.all([store.del('sheet'), store.del('state'), store.del('session')]); s = null; closePanel(); show($('work'), false); say(''); renderTop();
  };
  $('c1').onclick = () => { if (s) { s.cur = 1; save(); render(); } };
  $('c2').onclick = () => { if (s) { s.cur = 2; save(); render(); } };
  $('dev').onclick = askDev;
  $('find').onclick = () => doSearch($('code').value);
  $('code').onkeydown = (e) => { if (e.key === 'Enter') doSearch(e.target.value); };
  $('cam').onclick = () => (stream ? stopCam() : startCam());
  $('ph').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      if (!('BarcodeDetector' in window)) throw new Error('ta przeglądarka nie czyta kodów ze zdjęć');
      const b = await new BarcodeDetector().detect(await createImageBitmap(f));
      if (b.length) { $('code').value = b[0].rawValue; doSearch(b[0].rawValue); } else say('Nie rozpoznano kodu na zdjęciu.', true);
    } catch (err) { say('Błąd odczytu zdjęcia: ' + err.message, true); }
  };
  $('mn').onclick = () => { mode = 'n'; limit = PAGE; render(); };
  $('mi').onclick = () => { mode = 'i'; limit = PAGE; render(); };
  for (const f of ['all', 'todo', 'dif', 'cmp']) $(f).onclick = () => { filt = f; limit = PAGE; render(); };
  $('expx').onclick = exportXlsx; $('expc').onclick = exportCsv; $('exps').onclick = exportSession;
    const net = () => { $('net').textContent = navigator.onLine ? '' : '· offline'; };
  window.addEventListener('online', net); window.addEventListener('offline', net); net();
}

async function init() {
  bind();
  dev = (await store.get('device')) || '';
  try {
    s = await restore();
    if (s) show($('work'));
  } catch (e) { say('Nie udało się odtworzyć zapisanej sesji: ' + e.message, true); }
  render();
  if (!store.state.available) say('Uwaga: magazyn przeglądarki jest niedostępny (tryb prywatny?) — dane nie przetrwają zamknięcia karty. Zapisz wynik przed wyjściem.', true);
  if (!dev) setTimeout(askDev, 300);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
