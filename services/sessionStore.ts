import type { LogicModel } from '../types';

/**
 * Checkpoint record for one ProcessingFile — enough to resume a session after a tab
 * close/refresh/crash. Deliberately excludes `sourcePreviewImages` (large base64 JPEGs, already
 * treated as session-only elsewhere) and `progressMsg` (transient) — previews are regenerated
 * lazily from the stored `file` on demand instead of persisted eagerly.
 */
export interface PersistedFileRecord {
  id: string;
  file: File;
  status: 'pending' | 'converting' | 'extracting' | 'editing' | 'completed' | 'error';
  result?: LogicModel;
  warnings?: string[];
  extractionBlockers?: string[];
  error?: string;
  mismatchBannerDismissed?: boolean;
  fidelityBannerDismissed?: boolean;
  codingExportFidelityAck?: boolean;
  sourcePaneCollapsed?: boolean;
}

const DB_NAME = 'lm-extractor-session';
const DB_VERSION = 1;
const STORE_NAME = 'files';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open session store.'));
  });
  return dbPromise;
}

function promisifyTx(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed.'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted.'));
  });
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

/** True when IndexedDB is unavailable (older browser, private-mode restrictions, etc.). */
export function isSessionStoreAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

export async function saveFile(record: PersistedFileRecord): Promise<void> {
  if (!isSessionStoreAvailable()) return;
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put(record);
  await promisifyTx(tx);
}

export async function deleteFile(id: string): Promise<void> {
  if (!isSessionStoreAvailable()) return;
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).delete(id);
  await promisifyTx(tx);
}

export async function loadAll(): Promise<PersistedFileRecord[]> {
  if (!isSessionStoreAvailable()) return [];
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const result = await promisifyRequest(tx.objectStore(STORE_NAME).getAll());
  await promisifyTx(tx);
  return result;
}

export async function clearAll(): Promise<void> {
  if (!isSessionStoreAvailable()) return;
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).clear();
  await promisifyTx(tx);
}
