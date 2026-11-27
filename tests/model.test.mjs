import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../public/src/model.js';

const mk = (rows, mapping = { code: 0, item: 1, name: 2, qty: 3, type: null }) =>
  M.createSession({ name: 't', headers: ['Kod', 'Indeks', 'Nazwa', 'Ilość'], rows, mapping });

const rows = () => [['N1', 'A-1', 'Śruba', '10'], ['N2', 'A-1', 'Śruba', '5'], ['N3', 'B-2', 'Nakrętka', '7,5']];

test('parseNumber akceptuje przecinek i odrzuca śmieci', () => {
  assert.equal(M.parseNumber('7,5'), 7.5);
  assert.equal(M.parseNumber(' 12 '), 12);
  assert.equal(M.parseNumber('1 000'), 1000);
  for (const bad of ['', 'abc', '1e3', 'Infinity', '12abc', '1e999']) assert.equal(M.parseNumber(bad), null, bad);
});

test('licznik zgodny / rozbieżny / jedno liczenie', () => {
  const s = mk(rows());
  M.setCount(s, 0, 1, 10, 'A'); M.setCount(s, 0, 2, 10, 'B');
  M.setCount(s, 1, 1, 5, 'A'); M.setCount(s, 1, 2, 4, 'B');
  M.setCount(s, 2, 2, 7, 'B');
  assert.equal(M.finalCount(s, 0), 10);
  assert.equal(M.finalCount(s, 1), null);
  assert.equal(M.finalCount(s, 2), 7);
  assert.deepEqual([0, 1, 2].map((r) => M.rowStatus(s, r)), ['Zgodne L1=L2', 'RÓŻNICA L1≠L2', 'Tylko L2']);
});

test('liczenie 2 nie nadpisuje liczenia 1', () => {
  const s = mk(rows());
  M.setCount(s, 0, 1, 3, 'A'); M.setCount(s, 0, 2, 9, 'B');
  assert.equal(M.countOf(s, 0, 1), 3);
  assert.equal(M.countOf(s, 0, 2), 9);
});

test('setCount odrzuca wartości niepoprawne', () => {
  const s = mk(rows());
  for (const bad of [-1, NaN, Infinity, 1e10, '5', null]) assert.throws(() => M.setCount(s, 0, 1, bad, 'A'), RangeError);
});

test('sumy po indeksie: system, auto, ręczna ma pierwszeństwo', () => {
  const s = mk(rows());
  M.setCount(s, 0, 1, 10, 'A'); M.setCount(s, 1, 1, 4, 'A');
  let g = M.byItem(s, 1).get('A-1');
  assert.deepEqual([g.sys, g.auto, g.man, g.sum], [15, 14, null, 14]);
  M.setTotal(s, 'A-1', 1, 15, 'A');
  g = M.byItem(s, 1).get('A-1');
  assert.deepEqual([g.auto, g.man, g.sum], [14, 15, 15]);
  assert.equal(M.byItem(s, 1).get('B-2').sys, 7.5);
});

test('cache jest unieważniany po zmianie', () => {
  const s = mk(rows());
  assert.equal(M.byItem(s, 1).get('A-1').auto, null);
  M.setCount(s, 0, 1, 2, 'A');
  assert.equal(M.byItem(s, 1).get('A-1').auto, 2);
});

test('szukanie: kod, kod bez zer, indeks, fragmenty nazwy, brak', () => {
  const s = mk([['000123', 'A-1', 'Śruba M8', '1'], ['N2', 'A-1', 'Śruba M8', '1'], ['N3', 'B-2', 'Nakrętka M8', '1']]);
  assert.deepEqual(M.search(s, '123'), { kind: 'row', row: 0 });
  assert.deepEqual(M.search(s, 'n3'), { kind: 'row', row: 2 });
  assert.equal(M.search(s, 'a-1').kind, 'item');
  assert.equal(M.search(s, 'm8').kind, 'pick');
  assert.equal(M.search(s, 'śruba m8').rows.length, 2);
  assert.equal(M.search(s, 'zzz').kind, 'none');
  assert.equal(M.search(s, '').kind, 'none');
});

test('kod występujący na kilku pozycjach daje wybór', () => {
  const s = mk([['K1', 'A-1', 'x', '1'], ['K1', 'B-2', 'y', '1']]);
  assert.equal(M.search(s, 'K1').kind, 'pick');
});

test('REGRESJA: indeksy __proto__, constructor, toString nie psują programu ani Object.prototype', () => {
  const s = mk([['K1', '__proto__', 'x', '1'], ['K2', 'constructor', 'y', '2'], ['K3', 'toString', 'z', '3'], ['__proto__', 'hasOwnProperty', 'w', '4']]);
  for (let r = 0; r < 4; r++) M.setCount(s, r, 1, r + 1, 'A');
  M.setTotal(s, '__proto__', 1, 99, 'A');
  const g = M.byItem(s, 1);
  assert.equal(g.get('__proto__').man, 99);
  assert.equal(g.get('constructor').auto, 2);
  assert.equal(M.search(s, '__proto__').kind, 'row');
  assert.equal(M.search(s, 'constructor').kind, 'item');
  assert.equal(M.exportTables(s).data.length, 5);
  assert.equal({}.v, undefined);
  assert.equal(Object.prototype[1], undefined);
  assert.equal(Object.keys(Object.prototype).length, 0);
});

test('addRow dopisuje pozycję tylko do zmapowanych kolumn', () => {
  const s = mk(rows(), { code: 0, item: 1, name: 2, qty: null, type: null });
  const r = M.addRow(s, { code: 'NEW', item: 'Z-9', name: 'Nowy' });
  assert.deepEqual(s.rows[r], ['NEW', 'Z-9', 'Nowy', '']);
  assert.equal(M.rowsAll(s).includes(r), true);
});

test('eksport: dodatkowe kolumny, różnica do systemu, sumy indeksów', () => {
  const s = mk(rows());
  M.setCount(s, 0, 1, 12, 'Ola', new Date('2026-01-02T10:00:00Z')); M.setCount(s, 0, 2, 12, 'Adam');
  const { data, sums } = M.exportTables(s);
  const h = data[0], row = data[1];
  assert.equal(row[h.indexOf('Stan policzony (wynik)')], 12);
  assert.equal(row[h.indexOf('Różnica do systemu')], 2);
  assert.equal(row[3], 10);                 // ilość systemowa zamieniona na liczbę
  assert.equal(data[3][h.indexOf('Status')], 'Nie policzono');
  assert.equal(sums[0][0], 'Indeks');
  assert.equal(sums.length, 3);
});

test('mapowanie bez kolumny ilości: brak różnic, brak błędu', () => {
  const s = mk(rows(), { code: 0, item: 1, name: 2, qty: null, type: null });
  M.setCount(s, 0, 1, 4, 'A');
  assert.equal(M.exportTables(s).data[1][s.headers.length + 8], 4);
});
