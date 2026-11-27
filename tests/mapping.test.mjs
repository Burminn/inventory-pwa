import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../public/src/mapping.js';

test('podpowiedź mapowania: polskie nagłówki', () => {
  const m = P.suggestMapping(['Kod nośnika', 'Indeks', 'Nazwa indeksu', 'Ilość', 'Rodzaj nośnika']);
  assert.deepEqual(m, { code: 0, item: 1, name: 2, qty: 3, type: 4 });
});

test('podpowiedź mapowania: angielskie nagłówki, kolumna użyta raz', () => {
  const m = P.suggestMapping(['EAN', 'SKU', 'Description', 'Qty']);
  assert.deepEqual(m, { code: 0, item: 1, name: 2, qty: 3, type: null });
  const used = Object.values(m).filter((x) => x !== null);
  assert.equal(new Set(used).size, used.length);
});

test('podpowiedź ignoruje wielkość liter i ogonki', () => {
  const m = P.suggestMapping(['KOD NOSNIKA', 'INDEKS', 'ILOSC']);
  assert.equal(m.code, 0); assert.equal(m.item, 1); assert.equal(m.qty, 2);
});

test('nieznane nagłówki dają puste mapowanie (decyduje użytkownik)', () => {
  const m = P.suggestMapping(['A', 'B', 'C']);
  assert.ok(Object.values(m).every((x) => x === null));
});

test('walidacja mapowania', () => {
  assert.deepEqual(P.validateMapping({ code: 0, item: 1, name: null, qty: 2, type: null }, 3), []);
  assert.ok(P.validateMapping({ code: null, item: null, name: 0 }, 3).length);
  assert.ok(P.validateMapping({ code: 0, item: 0 }, 3).some((e) => e.includes('dwa razy')));
  assert.ok(P.validateMapping({ code: 5, item: 1 }, 3).length);
  assert.ok(P.validateMapping({ code: '1', item: 1 }, 3).length);
  assert.ok(P.validateMapping(null, 3).length);
});

test('sygnatura nagłówków jest stabilna i zależy od układu', () => {
  assert.equal(P.headerSignature(['A', 'B']), P.headerSignature(['a ', 'B']));
  assert.notEqual(P.headerSignature(['A', 'B']), P.headerSignature(['B', 'A']));
});

test('sanitizeMapping odrzuca śmieci z pamięci', () => {
  const m = P.sanitizeMapping({ code: 99, item: -1, name: '2', qty: 1, __proto__: { x: 1 } }, 3);
  assert.deepEqual(m, { code: null, item: null, name: null, qty: 1, type: null });
  assert.deepEqual(P.sanitizeMapping('x', 3), { code: null, item: null, name: null, qty: null, type: null });
});

test('wykrywanie wiersza nagłówków pomija puste i tytuły', () => {
  assert.equal(P.detectHeaderRow([[''], ['Raport inwentury'], ['Kod', 'Indeks'], ['1', '2']]), 2);
  assert.equal(P.detectHeaderRow([]), 0);
});
