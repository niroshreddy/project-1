import type { Comparison } from './types';
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('project-1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('comparisons', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('comparisons', mode);
    const request = operation(tx.objectStore('comparisons'));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Local history could not be saved.')); };
  });
}
export async function history(): Promise<Comparison[]> {
  const records = await transaction('readonly', store => store.getAll());
  return (records as Comparison[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function save(record: Comparison) {
  await transaction('readwrite', store => store.put(record));
  const records = await history();
  for (const old of records.slice(15)) await remove(old.id);
}
export async function remove(id: string) { await transaction('readwrite', store => store.delete(id)); }
