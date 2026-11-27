// Mapowanie kolumn: użytkownik wskazuje, która kolumna arkusza co oznacza.
// Program tylko podpowiada na podstawie nazw nagłówków (PL/EN) — ostatnie słowo ma zawsze człowiek.

import { ROLES, norm } from './model.js';

export const ROLE_LABELS = {
  code: 'Kod do skanowania (np. kod nośnika, EAN)',
  item: 'Indeks / SKU',
  name: 'Nazwa',
  qty: 'Ilość w systemie',
  type: 'Rodzaj / jednostka (opcjonalnie)',
};

const SYNONYMS = {
  code: ['kod nośnika', 'kod nosnika', 'kod kreskowy', 'kod', 'ean', 'barcode', 'nośnik', 'nosnik', 'lokalizacja', 'sscc', 'lpn', 'etykieta'],
  item: ['indeks', 'index', 'sku', 'symbol', 'artykuł', 'artykul', 'towar', 'kod towaru', 'nr katalogowy', 'item', 'part number'],
  name: ['nazwa indeksu', 'nazwa towaru', 'nazwa', 'opis', 'name', 'description'],
  qty: ['ilość w systemie', 'ilość', 'ilosc', 'stan systemowy', 'stan', 'qty', 'quantity'],
  type: ['rodzaj nośnika', 'rodzaj', 'typ', 'jm', 'jednostka', 'unit', 'type'],
};

const fold = (x) => norm(x).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');

/** Pierwszy z pierwszych 30 wierszy, który ma co najmniej 2 niepuste komórki. */
export function detectHeaderRow(aoa) {
  for (let r = 0; r < Math.min(aoa.length, 30); r++) {
    if (aoa[r].filter((c) => norm(c) !== '').length >= 2) return r;
  }
  return 0;
}

/** Podpowiedź mapowania: najpierw dokładne nazwy, potem zawieranie; kolumna użyta najwyżej raz. */
export function suggestMapping(headers) {
  const hs = headers.map(fold);
  const used = new Set();
  const out = Object.fromEntries(ROLES.map((r) => [r, null]));
  for (const pass of ['exact', 'contains']) {
    for (const role of ROLES) {
      if (out[role] !== null) continue;
      for (const syn of SYNONYMS[role].map(fold)) {
        const idx = hs.findIndex((h, i) => !used.has(i) && h !== '' && (pass === 'exact' ? h === syn : h.includes(syn)));
        if (idx >= 0) { out[role] = idx; used.add(idx); break; }
      }
    }
  }
  return out;
}

/** Zwraca listę błędów (pusta = mapowanie poprawne). */
export function validateMapping(mapping, columnCount) {
  const errors = [];
  if (!mapping || typeof mapping !== 'object') return ['Brak mapowania.'];
  const seen = new Map();
  for (const role of ROLES) {
    const c = mapping[role];
    if (c === null || c === undefined) continue;
    if (!Number.isInteger(c) || c < 0 || c >= columnCount) { errors.push(`Nieprawidłowa kolumna dla „${ROLE_LABELS[role]}”.`); continue; }
    if (seen.has(c)) errors.push(`Ta sama kolumna użyta dwa razy („${ROLE_LABELS[seen.get(c)]}” i „${ROLE_LABELS[role]}”).`);
    seen.set(c, role);
  }
  if ((mapping.code == null) && (mapping.item == null)) errors.push('Wskaż przynajmniej kolumnę z kodem do skanowania albo z indeksem.');
  return errors;
}

/** Skrót układu nagłówków — pod nim pamiętamy wybrane mapowanie. */
export function headerSignature(headers) {
  let h = 0x811c9dc5;
  const s = headers.map(fold).join('\u0001');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0') + ':' + headers.length;
}

/** Czyści mapowanie odczytane z pamięci (może pochodzić ze starej wersji lub być uszkodzone). */
export function sanitizeMapping(raw, columnCount) {
  const out = Object.fromEntries(ROLES.map((r) => [r, null]));
  if (!raw || typeof raw !== 'object') return out;
  for (const role of ROLES) {
    const v = Object.prototype.hasOwnProperty.call(raw, role) ? raw[role] : null;
    out[role] = Number.isInteger(v) && v >= 0 && v < columnCount ? v : null;
  }
  return out;
}
