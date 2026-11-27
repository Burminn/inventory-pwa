// Test end-to-end w prawdziwej przeglądarce (Playwright): npm run e2e
// Wymaga: npm ci && npm run build && npx playwright install chromium
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from '../../scripts/serve.mjs';

const require = createRequire(import.meta.url);
const ExcelJS = require('exceljs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inw-'));

async function makeXlsx(file) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Dane');
  ws.addRow(['Raport inwentury', '']);
  ws.addRow(['EAN', 'SKU', 'Opis', 'Qty']);
  ws.addRow(['0001', 'A-1', 'Śruba', 10]);
  ws.addRow(['0002', 'A-1', 'Śruba', 5]);
  ws.addRow(['0003', '__proto__', '<img src=x onerror=alert(1)>', 7]);
  ws.addRow(['0004', 'constructor', '=HYPERLINK("http://evil")', 2]);
  fs.writeFileSync(file, Buffer.from(await wb.xlsx.writeBuffer()));
}

const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;
const xlsx = path.join(tmp, 'dane.xlsx');
await makeXlsx(xlsx);

const browser = await chromium.launch();
const problems = [];
const watch = (page, tag) => {
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`${tag}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`${tag} pageerror: ${e.message}`));
  page.on('dialog', async (d) => { if (d.type() === 'prompt') await d.accept('Ola'); else if (d.message().startsWith('Usunąć wczytane')) await d.accept(); else { problems.push(`${tag} dialog: ${d.message()}`); await d.dismiss(); } });
};

const ctx1 = await browser.newContext({ acceptDownloads: true, viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx1.newPage(); watch(p, 'tel1');
await p.goto(url);
await p.waitForFunction(() => navigator.serviceWorker.ready.then(() => true));
await p.fill('#code', '').catch(() => {});
assert.equal(await p.locator('#dev').innerText(), 'Telefon: Ola');

// --- wczytanie + mapowanie
await p.setInputFiles('#file', xlsx);
await p.waitForSelector('#mapping:not(.hidden)');
const selects = p.locator('#mapping select');
const labels = await p.locator('#mapping label.f').allInnerTexts();
assert.ok(labels.some((l) => l.includes('Wiersz z nagłówkami')));
// auto: nagłówki w 2. wierszu
assert.equal(await selects.nth(0).inputValue(), '1');
await p.screenshot({ path: path.join(tmp, 'mapping.png') });
await p.click('text=Rozpocznij inwenturę');
await p.waitForSelector('#work:not(.hidden)');
assert.match(await p.locator('#info').innerText(), /4 pozycji/);

// --- liczenie 1: kod bez zer wiodących
await p.fill('#code', '1'); await p.click('#find');
await p.fill('#pn input[type=number]', '9'); await p.click('#pn >> text=Zatwierdź');
assert.match(await p.locator('#info').innerText(), /1 z 4/);

// --- złośliwe dane: tekst, nie HTML
assert.equal(await p.locator('#list img').count(), 0);
assert.ok((await p.locator('#list').innerText()).includes('<img src=x onerror=alert(1)>'));
await p.fill('#code', '__proto__'); await p.click('#find');
await p.fill('#pn input[type=number]', '7'); await p.click('#pn >> text=Zatwierdź');
const polluted = await p.evaluate(() => ({ a: ({}).v, b: Object.keys(Object.prototype).length }));
assert.deepEqual(polluted, { a: undefined, b: 0 });

// --- liczenie 2 niezależne
await p.click('#c2');
await p.fill('#code', '0001'); await p.click('#find');
assert.equal(await p.locator('#pn input[type=number]').inputValue(), '');   // liczenie „w ciemno”
await p.fill('#pn input[type=number]', '8'); await p.click('#pn >> text=Zatwierdź');
await p.click('#cmp');
assert.match(await p.locator('#list').innerText(), /L1: 9 · L2: 8/);
await p.screenshot({ path: path.join(tmp, 'work.png') });

// --- przywrócenie po przeładowaniu
await p.reload();
await p.waitForSelector('#work:not(.hidden)');
assert.match(await p.locator('#info').innerText(), /liczenie/);

// --- tryb offline
await ctx1.setOffline(true);
await p.reload();
await p.waitForSelector('#work:not(.hidden)');
assert.match(await p.locator('#net').innerText(), /offline/);
await ctx1.setOffline(false);

// --- eksport
const [dlx] = await Promise.all([p.waitForEvent('download'), p.click('#expx')]);
const xfile = path.join(tmp, 'wynik.xlsx'); await dlx.saveAs(xfile);
assert.match(dlx.suggestedFilename(), /_telefon_Ola\.xlsx$/);
const back = new ExcelJS.Workbook(); await back.xlsx.load(fs.readFileSync(xfile));
const sheet = back.worksheets[0];
const head = sheet.getRow(1).values.slice(1);
assert.ok(head.includes('Status') && head.includes('Liczenie 1 ilość'));
assert.equal(back.worksheets[1].name, 'Sumy indeksów');
const [dlc] = await Promise.all([p.waitForEvent('download'), p.click('#expc')]);
const csv = fs.readFileSync(await dlc.path(), 'utf8');
assert.ok(csv.includes("'=HYPERLINK"));
const [dls] = await Promise.all([p.waitForEvent('download'), p.click('#exps')]);
const jfile = path.join(tmp, 'tel1.inwent.json'); await dls.saveAs(jfile);

// --- drugi telefon: ten sam arkusz + scalenie
const ctx2 = await browser.newContext({ viewport: { width: 420, height: 900 } });
const q = await ctx2.newPage(); watch(q, 'tel2');
await q.goto(url);
await q.setInputFiles('#file', xlsx);
await q.waitForSelector('#mapping:not(.hidden)');
await q.click('text=Rozpocznij inwenturę');
await q.waitForSelector('#work:not(.hidden)');
await q.setInputFiles('#file2', jfile);
await q.waitForFunction(() => /Dodano wpisów: 3/.test(document.getElementById('msg').textContent));
assert.match(await q.locator('#msg').innerText(), /Konflikty \(zostawiono Twoje\): 0/);

// --- zepsuty plik sesji
fs.writeFileSync(path.join(tmp, 'zly.json'), '{"format":"inwentaryzacja-pwa","version":1,"headers":[],"rows":[]}');
await q.setInputFiles('#file2', path.join(tmp, 'zly.json'));
await q.waitForFunction(() => /Nieprawidłowy plik sesji/.test(document.getElementById('msg').textContent));

// --- CSV z Windows-1250 i brakiem rozpoznanych nagłówków
const csvFile = path.join(tmp, 'x.csv');
fs.writeFileSync(csvFile, Buffer.from('A;B;C\n1;x;3\n', 'latin1'));
await q.click('#clear').catch(() => {});
await q.setInputFiles('#file', csvFile);
await q.waitForSelector('#mapping:not(.hidden)');
await q.click('text=Rozpocznij inwenturę');
assert.match(await q.locator('#msg').innerText(), /Wskaż przynajmniej/);

await browser.close(); server.close();
if (problems.length) { console.error('PROBLEMY:\n' + problems.join('\n')); process.exit(1); }
for (const f of ['mapping.png', 'work.png']) fs.copyFileSync(path.join(tmp, f), path.join(process.cwd(), 'docs', f));
console.log('E2E OK');
