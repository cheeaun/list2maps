// In-memory stand-in for `void/kv` so the real server lib can run
// under plain Node (whose fetch honours the sandbox egress proxy).
export const store = new Map<string, { value: unknown; expiresAt: number }>();

export const kv = {
  async get<T>(key: string): Promise<T | null> {
    const e = store.get(key);
    if (!e) return null;
    if (Date.now() > e.expiresAt) {
      store.delete(key);
      return null;
    }
    return e.value as T;
  },
  async put(
    key: string,
    value: unknown,
    opts?: { ttl?: number; expiration?: number; metadata?: unknown },
  ): Promise<void> {
    const ttlMs = opts?.ttl
      ? opts.ttl * 1000
      : opts?.expiration
        ? opts.expiration * 1000 - Date.now()
        : 24 * 3600 * 1000;
    store.set(key, { value, expiresAt: Date.now() + ttlMs });
  },
  async delete(key: string): Promise<void> {
    store.delete(key);
  },
  async list(opts?: { prefix?: string }) {
    const keys = [...store.keys()]
      .filter((k) => !opts?.prefix || k.startsWith(opts.prefix))
      .map((name) => ({ name }));
    return { keys, list_complete: true };
  },
  async getWithMetadata<T>(key: string) {
    return { value: await kv.get<T>(key), metadata: null };
  },
  map<T>(_prefix: string) {
    return kv as unknown as {
      get: (k: string) => Promise<T | null>;
      put: (k: string, v: T, o?: { ttl?: number }) => Promise<void>;
      delete: (k: string) => Promise<void>;
      list: () => Promise<{ keys: { name: string }[]; list_complete: boolean }>;
      getWithMetadata: (k: string) => Promise<{ value: T | null; metadata: null }>;
    };
  },
};
