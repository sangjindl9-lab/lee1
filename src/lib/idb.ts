"use client";

/** 업로드 파일을 IndexedDB 에 임시 보관해, 앱을 다시 열어도 실패 항목을 그대로 재시도할 수 있게 한다. */
const DB_NAME = "family-album-uploads";
const STORE = "files";

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export async function saveUploadFile(key: string, file: File): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ blob: file, name: file.name, type: file.type, lastModified: file.lastModified }, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

export async function loadUploadFile(key: string): Promise<File | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => {
      const row = req.result as { blob: Blob; name: string; type: string; lastModified: number } | undefined;
      if (!row) return resolve(null);
      resolve(new File([row.blob], row.name, { type: row.type, lastModified: row.lastModified }));
    };
    req.onerror = () => resolve(null);
  });
}

export async function deleteUploadFile(key: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function clearUploadFiles(keys: string[]): Promise<void> {
  await Promise.all(keys.map((k) => deleteUploadFile(k)));
}
