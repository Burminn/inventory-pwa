// Wczytywanie i zapis tabel: CSV (własny parser) i XLSX (ExcelJS, ładowany dopiero, gdy potrzebny).

import { norm } from './model.js';

export const LIMITS = { fileBytes: 15 * 1024 * 1024, rows: 200000, cols: 200, cell: 500 };

let excel = null;
export function setExcelJS(lib) { excel = lib; }
export async function getExcelJS() {
  if (excel) return excel;
  if (typeof document === 'undefined') throw new Error('Biblioteka ExcelJS nie jest załadowana.');
  await new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = 'vendor/exceljs.min.js';
    el.onload = resolve;
    el.onerror = () => reject(new Error('Nie udało się załadować biblioteki Excela (uruchom „npm run build”).'));
    document.head.append(el);
  });
  if (!globalThis.ExcelJS) throw new Error('Biblioteka Excela jest niepoprawna.');
  excel = globalThis.ExcelJS;
  return excel;
}

export function decodeBytes(buf) {
  const u8 = new Uint8Array(buf);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u8).replace(/^﻿/, ''); }
  catch { return new TextDecoder('windows-1250').decode(u8); }   // typowe dla polskich eksportów
}

function sniffDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== '') || '';
  let best = ',', bestN = 0, inQ = false;
  const counts = { ';': 0, ',': 0, '\t': 0 };
  for (const ch of firstLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]++;
  }
  for (const d of [';', '\t', ',']) if (counts[d] > bestN) { best = d; bestN = counts[d]; }
  return best;
}

export function parseCsv(text, delimiter) {
  const d = delimiter || sniffDelimiter(text);
  const rows = [];
  let row = [], field = '', inQ = false, i = 0;
  const pushField = () => {
    if (row.length >= LIMITS.cols) throw new Error('Za dużo kolumn (limit ' + LIMITS.cols + ').');
    row.push(field.slice(0, LIMITS.cell)); field = '';
  };
  const pushRow = () => {
    pushField();
    if (row.some((c) => c !== '')) rows.push(row);
    if (rows.length > LIMITS.rows) throw new Error('Za dużo wierszy (limit ' + LIMITS.rows + ').');
    row = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"' && field === '') inQ = true;
    else if (ch === d) pushField();
    else if (ch === '\n') pushRow();
    else if (ch === '\r') { if (text[i + 1] === '\n') i++; pushRow(); }
    else field += ch;
    i++;
  }
  if (field !== '' || row.length) pushRow();
  return rows;
}

const FORMULA_START = /^[=+\-@\t\r]/;
/** CSV do Excela (średnik, BOM); wartości zaczynające się od =,+,-,@ są neutralizowane (formula injection). */
export function toCsv(aoa, delimiter = ';') {
  const q = (v) => {
    let s = v == null ? '' : String(v);
    if (typeof v === 'string' && FORMULA_START.test(s)) s = "'" + s;
    return /["\r\n]/.test(s) || s.includes(delimiter) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '﻿' + aoa.map((r) => r.map(q).join(delimiter)).join('\r\n') + '\r\n';
}

function cellText(c) {
  try { return norm(c.text); } catch { return ''; }
}

/** Zwraca {sheetNames, sheet, aoa}. `file` to {name, buffer: ArrayBuffer}. */
export async function readTable({ name, buffer }, sheetIndex = 0) {
  if (buffer.byteLength > LIMITS.fileBytes) throw new Error('Plik jest za duży (limit ' + LIMITS.fileBytes / 1048576 + ' MB).');
  const lower = name.toLowerCase();
  if (/\.(csv|txt|tsv)$/.test(lower)) return { sheetNames: [], sheet: '', aoa: parseCsv(decodeBytes(buffer)) };
  if (lower.endsWith('.xls')) throw new Error('Format .xls (stary Excel) nie jest obsługiwany — zapisz plik jako .xlsx lub CSV.');
  if (!lower.endsWith('.xlsx')) throw new Error('Obsługiwane formaty: .xlsx, .csv.');
  const E = await getExcelJS();
  const wb = new E.Workbook();
  await wb.xlsx.load(buffer);
  const sheets = wb.worksheets;
  if (!sheets.length) throw new Error('Skoroszyt nie zawiera arkuszy.');
  const ws = sheets[Math.min(Math.max(sheetIndex, 0), sheets.length - 1)];
  const aoa = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    if (aoa.length >= LIMITS.rows) throw new Error('Za dużo wierszy (limit ' + LIMITS.rows + ').');
    const out = [];
    row.eachCell({ includeEmpty: true }, (c, col) => {
      if (col > LIMITS.cols) return;
      out[col - 1] = cellText(c).slice(0, LIMITS.cell);
    });
    for (let i = 0; i < out.length; i++) if (out[i] === undefined) out[i] = '';
    aoa.push(out);
  });
  return { sheetNames: sheets.map((x) => x.name), sheet: ws.name, aoa };
}

const badSheetChars = /[\\/?*[\]:]/g;
/** sheets: [{name, aoa}] -> ArrayBuffer .xlsx. Teksty zapisywane są jako tekst (nigdy jako formuły). */
export async function writeXlsx(sheets) {
  const E = await getExcelJS();
  const wb = new E.Workbook();
  wb.created = new Date();
  for (const { name, aoa } of sheets) {
    const ws = wb.addWorksheet(String(name).replace(badSheetChars, '_').slice(0, 31) || 'Arkusz');
    const widths = [];
    aoa.forEach((r) => {
      ws.addRow(r.map((v) => (v === '' || v == null ? null : v)));
      r.forEach((v, i) => { widths[i] = Math.min(Math.max(widths[i] || 8, String(v ?? '').length + 2), 50); });
    });
    ws.columns.forEach((c, i) => { c.width = widths[i] || 10; });
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }
  return wb.xlsx.writeBuffer();
}
