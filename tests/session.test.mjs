import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../public/src/model.js';
import * as S from '../public/src/session.js';

const base = (extra = []) => M.createSession({
  name: 'arkusz', headers: ['Kod', 'Indeks', 'Nazwa', 'Ilość'],
  rows: [['N1', 'A-1', 'Śruba', '10'], ['N2', 'B-2', 'Nakrętka', '4'], ...extra],
  mapping: { code: 0, item: 1, name: 2, qty: 3, type: null },
});

test('serializacja i odczyt zachowują liczenia i sumy', () => {
  const s = base();
  M.setCount(s, 0, 1, 9, 'Ola'); M.setCount(s, 1, 2, 3, 'Adam'); M.setTotal(s, 'A-1', 2, 11, 'Adam'); s.cur = 2;
  const back = S.parseJson(JSON.stringify(S.serialize(s)));
  assert.equal(M.countOf(back, 0, 1), 9);
  assert.equal(M.countOf(back, 1, 2), 3);
  assert.equal(back.totals.get('A-1').get(2).v, 11);
  assert.equal(back.cur, 2);
  assert.equal(back.sourceId, s.sourceId);
});

test('scalanie: dokłada brakujące wpisy, lokalnych nie nadpisuje, liczy konflikty', () => {
  const a = base(), b = base();
  M.setCount(a, 0, 1, 10, 'Ola');
  M.setCount(b, 0, 1, 99, 'Adam');       // konflikt z a
  M.setCount(b, 1, 2, 4, 'Adam');        // nowy wpis
  M.setTotal(b, 'B-2', 2, 4, 'Adam');
  const res = S.merge(a, S.deserialize(S.serialize(b)));
  assert.deepEqual([res.added, res.conflicts, res.newRows, res.sameSource], [2, 1, 0, true]);
  assert.equal(M.countOf(a, 0, 1), 10);
  assert.equal(M.countOf(a, 1, 2), 4);
});

test('scalanie dokłada nowe nośniki z drugiego telefonu', () => {
  const a = base(), b = base();
  const r = M.addRow(b, { code: 'NEW', item: 'Z-9', name: 'Nowy' });
  M.setCount(b, r, 1, 2, 'Adam');
  const res = S.merge(a, S.deserialize(S.serialize(b)));
  assert.equal(res.newRows, 1);
  assert.equal(a.rows.length, 3);
  assert.equal(M.countOf(a, 2, 1), 2);
});

test('scalanie działa też przy innym układzie kolumn (mapowanie z pliku)', () => {
  const a = base();
  const b = M.createSession({ name: 'b', headers: ['Indeks', 'Ilość', 'Kod'], rows: [['A-1', '10', 'N1']], mapping: { code: 2, item: 0, name: null, qty: 1, type: null } });
  M.setCount(b, 0, 2, 7, 'Adam');
  const res = S.merge(a, S.deserialize(S.serialize(b)));
  assert.equal(res.newRows, 0);
  assert.equal(M.countOf(a, 0, 2), 7);
  assert.equal(res.sameSource, false);
});

const good = () => S.serialize(base());
const bad = (mut) => { const o = JSON.parse(JSON.stringify(good())); mut(o); return o; };

test('walidacja odrzuca zepsute pliki', () => {
  const cases = [
    (o) => { o.format = 'inne'; }, (o) => { o.version = 99; }, (o) => { o.headers = []; },
    (o) => { o.rows = 'x'; }, (o) => { o.rows[0] = 5; }, (o) => { o.mapping = { code: null, item: null }; },
    (o) => { o.mapping.item = 99; }, (o) => { o.counts = [['k', { 1: { v: 'x' } }]]; },
    (o) => { o.counts = [['k', { 1: { v: -3 } }]]; }, (o) => { o.counts = [['k', { 1: { v: 1e12 } }]]; },
    (o) => { o.counts = [[5, {}]]; }, (o) => { o.totals = null; },
  ];
  for (const mut of cases) assert.throws(() => S.deserialize(bad(mut)), /Nieprawidłowy plik sesji/);
  assert.throws(() => S.parseJson('{nie json'), /JSON/);
  assert.throws(() => S.parseJson('x'.repeat(S.LIMITS.bytes + 1)), /za duży/);
});

test('REGRESJA: złośliwy JSON z kluczami __proto__ / constructor nie zatruwa prototypu', () => {
  const json = '{"format":"inwentaryzacja-pwa","version":1,"headers":["Kod","Indeks"],"rows":[["K","__proto__"]],' +
    '"mapping":{"code":0,"item":1,"name":null,"qty":null,"type":null,"__proto__":{"polluted":1}},"cur":1,' +
    '"counts":[["K|__proto__",{"1":{"v":1,"t":"2026-01-01T00:00:00Z","d":"x"},"__proto__":{"polluted":1}}]],' +
    '"totals":[["__proto__",{"1":{"v":2,"t":"2026-01-01T00:00:00Z","d":"x"},"constructor":{"prototype":{"polluted":1}}}]]}';
  const s = S.parseJson(json);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(s.totals.get('__proto__').get(1).v, 2);
  assert.equal(M.byItem(s, 1).get('__proto__').man, 2);
});

test('deserializacja przycina długie teksty i poprawia złą datę', () => {
  const o = bad((x) => { x.counts = [['N1|A-1', { 1: { v: 1, t: 'nie-data', d: 'x'.repeat(1000) } }]]; });
  const s = S.deserialize(o);
  const e = s.counts.get('N1|A-1').get(1);
  assert.equal(e.d.length, 80);
  assert.equal(e.t, new Date(0).toISOString());
});
