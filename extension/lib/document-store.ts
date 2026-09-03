const DB_NAME = 'autofiller-documents';
const STORE_NAME = 'handles';
const FOLDER_KEY = 'documentsFolder';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Stores a FileSystemDirectoryHandle in IndexedDB, scoped to the extension's
 * own origin (chrome-extension://<id>). Shared between the options page and
 * the popup, since both are served from that same origin.
 */
export async function saveDocumentsFolderHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(handle, FOLDER_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getDocumentsFolderHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(FOLDER_KEY);
    req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

/** Ensures we still have read permission for a previously-granted handle, prompting if needed. */
export async function ensureReadPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const options = { mode: 'read' as const };
  if ((await handle.queryPermission(options)) === 'granted') return true;
  return (await handle.requestPermission(options)) === 'granted';
}

/**
 * Ensures we can write into the folder, prompting if the existing grant is
 * read-only.
 *
 * Kept separate from the read grant on purpose: attaching documents needs only
 * to read, and asking for write access up front would be asking for more than
 * the feature in front of the user requires. The prompt appears the first time
 * a generated resume is actually saved.
 */
export async function ensureWritePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const options = { mode: 'readwrite' as const };
  if ((await handle.queryPermission(options)) === 'granted') return true;
  return (await handle.requestPermission(options)) === 'granted';
}

/**
 * Writes a generated document into the linked folder, where the existing
 * attach path will find it like any other file.
 *
 * Never overwrites: a name already taken gains a numeric suffix. Silently
 * replacing a resume the user tailored by hand would be the worst kind of
 * data loss — invisible until they opened the file.
 */
export async function saveToDocumentsFolder(
  handle: FileSystemDirectoryHandle,
  filename: string,
  blob: Blob
): Promise<string> {
  if (!(await ensureWritePermission(handle))) {
    throw new Error('Permission to write into your documents folder was not granted.');
  }

  const finalName = await freeFilename(handle, filename);
  const file = await handle.getFileHandle(finalName, { create: true });
  const writable = await file.createWritable();
  await writable.write(blob);
  await writable.close();
  return finalName;
}

/** `Resume_Enpal.docx` → `Resume_Enpal (2).docx` when the first is taken. */
async function freeFilename(handle: FileSystemDirectoryHandle, filename: string): Promise<string> {
  const dot = filename.lastIndexOf('.');
  const stem = dot === -1 ? filename : filename.slice(0, dot);
  const ext = dot === -1 ? '' : filename.slice(dot);

  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? filename : `${stem} (${n})${ext}`;
    try {
      await handle.getFileHandle(candidate);
    } catch {
      // Not found is the outcome we want: the name is free.
      return candidate;
    }
  }
  return `${stem} (${Date.now()})${ext}`;
}

/**
 * Whether this browser can link a documents folder at all.
 *
 * The File System Access API is Chromium-only. The Firefox build scripts
 * advertised a browser where this feature silently does nothing — the button
 * was there, and pressing it achieved nothing anyone could see. Better to say
 * so than to offer a control that cannot work.
 */
export function supportsDocumentsFolder(): boolean {
  return typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

/**
 * Asks the user to pick their documents folder, and saves the handle.
 *
 * The picker call lives here rather than in the component so the one place
 * that knows about the File System Access API is the module that owns folder
 * handles — the same module that already feature-detects it above. It also
 * keeps the UI off an ambient DOM global that not every editor's TypeScript
 * setup resolves.
 *
 * Returns null when the user closes the picker without choosing, which is a
 * normal outcome and not an error.
 */
export async function pickDocumentsFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!supportsDocumentsFolder()) {
    throw new Error('This browser cannot link a folder — the File System Access API is Chromium-only.');
  }

  try {
    const handle = await globalThis.showDirectoryPicker({ mode: 'read' });
    await saveDocumentsFolderHandle(handle);
    return handle;
  } catch (err) {
    // Closing the picker throws AbortError. Nothing went wrong.
    if (err instanceof Error && err.name === 'AbortError') return null;
    throw err;
  }
}
