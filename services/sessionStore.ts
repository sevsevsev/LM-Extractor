import type { LogicModel } from '../types';

/**
 * Checkpoint record for one ProcessingFile — enough to resume a session after a tab
 * close/refresh/crash. Deliberately excludes `sourcePreviewImages` (large base64 JPEGs, already
 * treated as session-only elsewhere) and `progressMsg` (transient) — previews are regenerated
 * lazily from the stored `file` on demand instead of persisted eagerly.
 *
 * `file` is always populated on anything `loadAll()` returns — for a multi-logic-model split
 * entry (`sourceDocumentId` set), the underlying blob is stored once in the `sourceDocuments`
 * store (see below) rather than once per sibling, and `loadAll()` re-attaches it before
 * returning. See docs/specs/multi-logic-model-pdf-v1.md.
 */
export interface PersistedFileRecord {
  id: string;
  file: File;
  status: 'pending' | 'converting' | 'detecting' | 'extracting' | 'editing' | 'completed' | 'error';
  result?: LogicModel;
  warnings?: string[];
  extractionBlockers?: string[];
  error?: string;
  mismatchBannerDismissed?: boolean;
  fidelityBannerDismissed?: boolean;
  codingExportFidelityAck?: boolean;
  sourcePaneCollapsed?: boolean;
  sourceDocumentId?: string;
  sourcePageRange?: { start: number; end: number };
  splitPartLabel?: string;
  forceSingleModel?: boolean;
  /** Which prompt produced `result` — kept so a resumed session still exports an honest log. */
  promptVersion?: string;
  promptVariant?: string;
}

/** As actually stored in the `files` object store — `file` omitted for a split entry. */
type StoredFileRecord = Omit<PersistedFileRecord, 'file'> & { file?: File };

const DB_NAME = 'lm-extractor-session';
const DB_VERSION = 2;
const STORE_NAME = 'files';
/** One shared File per multi-logic-model upload, keyed by `sourceDocumentId` — see above. */
const SOURCE_DOCS_STORE = 'sourceDocuments';

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
      if (!db.objectStoreNames.contains(SOURCE_DOCS_STORE)) {
        db.createObjectStore(SOURCE_DOCS_STORE, { keyPath: 'id' });
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

/**
 * Serialize writes through one shared chain instead of letting callers fire many concurrent
 * transactions. A large batch add (e.g. 100+ files) makes every one of them newly-eligible to
 * checkpoint at roughly the same moment (App.tsx's debounce timers all expire together) — without
 * this, that's N simultaneous readwrite transactions each structured-cloning a multi-MB File blob,
 * which is exactly the kind of write storm that can stall a tab for many seconds (worse in some
 * browsers' IndexedDB implementations than others). One write at a time keeps the browser
 * responsive regardless of batch size; a failed write doesn't wedge the chain for the next one.
 */
let writeQueue: Promise<void> = Promise.resolve();

function enqueueWrite(run: () => Promise<void>): Promise<void> {
  const result = writeQueue.then(run, run);
  writeQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

export async function saveFile(record: PersistedFileRecord): Promise<void> {
  if (!isSessionStoreAvailable()) return;
  return enqueueWrite(async () => {
    const db = await openDb();
    if (record.sourceDocumentId) {
      const tx = db.transaction([STORE_NAME, SOURCE_DOCS_STORE], 'readwrite');
      // Idempotent overwrite of the same bytes when a sibling saves again — cheap, and simpler
      // than tracking "already written" across siblings.
      tx.objectStore(SOURCE_DOCS_STORE).put({ id: record.sourceDocumentId, file: record.file });
      const { file: _file, ...stored } = record;
      tx.objectStore(STORE_NAME).put(stored);
      await promisifyTx(tx);
    } else {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record);
      await promisifyTx(tx);
    }
  });
}

export async function deleteFile(id: string): Promise<void> {
  if (!isSessionStoreAvailable()) return;
  return enqueueWrite(async () => {
    const db = await openDb();
    const tx = db.transaction([STORE_NAME, SOURCE_DOCS_STORE], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const all = (await promisifyRequest(store.getAll())) as StoredFileRecord[];
    const existing = all.find(r => r.id === id);
    store.delete(id);
    // Only drop the shared source document once no other split sibling still references it.
    if (existing?.sourceDocumentId) {
      const stillUsed = all.some(r => r.id !== id && r.sourceDocumentId === existing.sourceDocumentId);
      if (!stillUsed) tx.objectStore(SOURCE_DOCS_STORE).delete(existing.sourceDocumentId);
    }
    await promisifyTx(tx);
  });
}

export async function loadAll(): Promise<PersistedFileRecord[]> {
  if (!isSessionStoreAvailable()) return [];
  const db = await openDb();
  const tx = db.transaction([STORE_NAME, SOURCE_DOCS_STORE], 'readonly');
  const records = (await promisifyRequest(tx.objectStore(STORE_NAME).getAll())) as StoredFileRecord[];
  const sourceDocs = (await promisifyRequest(tx.objectStore(SOURCE_DOCS_STORE).getAll())) as {
    id: string;
    file: File;
  }[];
  await promisifyTx(tx);
  const fileByDocId = new Map(sourceDocs.map(d => [d.id, d.file]));
  return records
    .map(r => (r.file ? (r as PersistedFileRecord) : { ...r, file: fileByDocId.get(r.sourceDocumentId!) }))
    .filter((r): r is PersistedFileRecord => Boolean(r.file));
}

export async function clearAll(): Promise<void> {
  if (!isSessionStoreAvailable()) return;
  return enqueueWrite(async () => {
    const db = await openDb();
    const tx = db.transaction([STORE_NAME, SOURCE_DOCS_STORE], 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.objectStore(SOURCE_DOCS_STORE).clear();
    await promisifyTx(tx);
  });
}
