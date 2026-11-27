// Kopiuje bibliotekę ExcelJS z node_modules do public/vendor (aplikacja działa potem offline).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'node_modules', 'exceljs', 'dist', 'exceljs.min.js');
const dst = path.join(root, 'public', 'vendor', 'exceljs.min.js');
if (!fs.existsSync(src)) { console.error('Brak node_modules/exceljs — uruchom najpierw: npm ci'); process.exit(1); }
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.copyFileSync(src, dst);
console.log('OK:', path.relative(root, dst));
