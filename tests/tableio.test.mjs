import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import * as T from '../public/src/tableio.js';

const require = createRequire(import.meta.url);
let hasExcel = true;
try { T.setExcelJS(require('exceljs')); } catch { hasExcel = false; }

test('CSV: średnik, cudzysłowy, przecinek dziesiętny, puste wiersze', () => {
  const rows = T.parseCsv('Kod;Nazwa;Ilość\r\nA1;"Śruba; M8";"7,5"\r\n\r\nA2;"cytat ""x""";3\r\n');
  assert.deepEqual(rows, [['Kod', 'Nazwa', 'Ilość'], ['A1', 'Śruba; M8', '7,5'], ['A2', 'cytat "x"', '3']]);
});

test('CSV: automatyczny wybór separatora i znaki nowej linii w polu', () => {
  assert.deepEqual(T.parseCsv('a,b\n1,"x\ny"'), [['a', 'b'], ['1', 'x\ny']]);
  assert.deepEqual(T.parseCsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
});

test('CSV: limity kolumn i wierszy', () => {
  assert.throws(() => T.parseCsv(','.repeat(300) + '\n'), /kolumn/);
});

test('dekodowanie: UTF-8 z BOM i Windows-1250', () => {
  assert.equal(T.decodeBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]).buffer), 'a');
  assert.equal(T.decodeBytes(Buffer.from([0xb3, 0xf3, 0x64, 0x9f])), 'łódź');
});

test('eksport CSV neutralizuje formuły i cytuje pola', () => {
  const out = T.toCsv([['a', '=HYPERLINK("x")'], ['+1', 'x;y'], [5, '-2']]);
  assert.ok(out.startsWith('﻿'));
  assert.ok(out.includes("'=HYPERLINK"));
  assert.ok(out.includes("'+1"));
  assert.ok(out.includes('"x;y"'));
  assert.ok(out.includes(';5') || out.includes('5;'));   // liczby (nie napisy) bez apostrofu
});

test('odrzuca .xls i nieobsługiwane rozszerzenia oraz zbyt duże pliki', async () => {
  await assert.rejects(T.readTable({ name: 'a.xls', buffer: new ArrayBuffer(10) }), /xls/);
  await assert.rejects(T.readTable({ name: 'a.pdf', buffer: new ArrayBuffer(10) }), /Obsługiwane/);
  await assert.rejects(T.readTable({ name: 'a.csv', buffer: new ArrayBuffer(T.LIMITS.fileBytes + 1) }), /za duży/);
});

test('XLSX: zapis i odczyt, formuły zostają tekstem', { skip: !hasExcel && 'brak exceljs (npm ci)' }, async () => {
  const buf = await T.writeXlsx([
    { name: 'Dane/1', aoa: [['Kod', 'Ilość'], ['=1+1', 5], ['00123', '7,5']] },
    { name: 'Sumy', aoa: [['x']] },
  ]);
  const back = await T.readTable({ name: 'x.xlsx', buffer: buf });
  assert.deepEqual(back.sheetNames, ['Dane_1', 'Sumy']);
  assert.deepEqual(back.aoa, [['Kod', 'Ilość'], ['=1+1', '5'], ['00123', '7,5']]);
  const second = await T.readTable({ name: 'x.xlsx', buffer: buf }, 1);
  assert.deepEqual(second.aoa, [['x']]);
});

test('XLSX: uszkodzony plik daje błąd, nie zawieszenie', { skip: !hasExcel && 'brak exceljs' }, async () => {
  await assert.rejects(T.readTable({ name: 'x.xlsx', buffer: Buffer.from('to nie jest zip') }));
});
