// Magazyn w IndexedDB (localStorage ma ~5 MB i nie wystarczy na duży arkusz).
// Gdy IndexedDB jest niedostępne (np. tryb prywatny), działa w pamięci i `available` jest false.

const DB_NAME = 'inwentaryzacja', STORE = 'kv';
let dbp = null;
const mem = new Map();
export const state = { available: true };

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('Brak IndexedDB')); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((e) => { state.available = false; throw e; });
  }
  return dbp;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r && r.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function get(key) {
  try { return await tx('readonly', (s) => s.get(key)); } catch { return mem.get(key); }
}
export async function set(key, value) {
  try { await tx('readwrite', (s) => s.put(value, key)); return true; }
  catch { mem.set(key, value); return false; }
}
export async function del(key) {
  mem.delete(key);
  try { await tx('readwrite', (s) => s.delete(key)); } catch { /* brak magazynu */ }
}
export async function requestPersistence() {
  try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch { return false; }
}
