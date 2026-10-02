const MAX_ENTRIES = 500;
const MAX_PENDING = 128;
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ENTRY_BYTES = 1024 * 1024;
let bytes = 0;
type Entry = { data: unknown; expires: number; tags: string[]; size: number };
type Pending = { promise: Promise<unknown>; tags: string[] };
const store = new Map<string, Entry>();
const pending = new Map<string, Pending>();
let generation = 0;

function remove(key: string): void {
  const entry = store.get(key);
  if (entry) bytes -= entry.size;
  store.delete(key);
}

export function clearMemCache(tags?: string[]): void {
  generation++;
  if (!tags) { store.clear(); bytes = 0; pending.clear(); return; }
  for (const [key, entry] of store) if (entry.tags.some(tag => tags.includes(tag))) remove(key);
  for (const [key, entry] of pending) if (entry.tags.some(tag => tags.includes(tag))) pending.delete(key);
}

export async function memCache<T>(key: string, ttlMs: number, fn: () => Promise<T>, tags: string[] = []): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) {
    store.delete(key); store.set(key, hit);
    return hit.data as T;
  }
  const running = pending.get(key);
  if (running) return running.promise as Promise<T>;
  if (pending.size >= MAX_PENDING) return fn();
  const epoch = generation;
  const work = { promise: Promise.resolve().then(fn), tags };
  pending.set(key, work);
  try {
    const data = await work.promise;
    if (epoch === generation) {
      // Approximate retained string/object size; large results bypass this cache.
      const size = Buffer.byteLength(JSON.stringify(data) ?? '', 'utf8') * 2;
      if (size <= MAX_ENTRY_BYTES) {
        for (const [oldKey, entry] of store) if (entry.expires <= Date.now()) remove(oldKey);
        while (store.size && (store.size >= MAX_ENTRIES || bytes + size > MAX_BYTES)) remove(store.keys().next().value!);
        remove(key);
        store.set(key, { data, expires: Date.now() + ttlMs, tags, size });
        bytes += size;
      }
    }
    return data;
  } finally { if (pending.get(key) === work) pending.delete(key); }
}
