// SWR cache over Cloudflare KV (via `void/kv`).
//
// Chee's spec: cache for 4 hours. Implemented as stale-while-revalidate:
//   - age < 4h: serve the cached value, no upstream call.
//   - 4h <= age < 24h: serve the cached value AND refresh in the
//     background (ExecutionContext.waitUntil, when available).
//   - age >= 24h (or missing): fetch live; if that fails and a stale
//     value exists, serve the stale value instead of erroring.
// The KV entry itself lives 24h; the 4h freshness window is enforced
// in code via the stored fetchedAt timestamp.

import { kv } from 'void/kv';

export const FRESH_SECONDS = 4 * 3600;
const STALE_SECONDS = 24 * 3600;

interface Envelope<T> {
  fetchedAt: number; // epoch ms
  data: T;
}

export interface SwrResult<T> {
  data: T;
  cached: boolean;
  stale: boolean;
  fetchedAt: string; // ISO timestamp of the data being served
}

type WaitUntilable = {
  executionCtx?: { waitUntil?: (p: Promise<unknown>) => void };
};

export async function swrGet<T>(
  key: string,
  fetcher: () => Promise<T>,
  ctx?: WaitUntilable,
): Promise<SwrResult<T>> {
  const raw = await kv.get<Envelope<T>>(key);
  const now = Date.now();

  const refresh = async (): Promise<Envelope<T> | null> => {
    try {
      const data = await fetcher();
      const env: Envelope<T> = { fetchedAt: Date.now(), data };
      await kv.put(key, env, { ttl: STALE_SECONDS });
      return env;
    } catch {
      return null;
    }
  };

  if (raw) {
    const ageSeconds = (now - raw.fetchedAt) / 1000;
    if (ageSeconds < FRESH_SECONDS) {
      return {
        data: raw.data,
        cached: true,
        stale: false,
        fetchedAt: new Date(raw.fetchedAt).toISOString(),
      };
    }
    if (ageSeconds < STALE_SECONDS) {
      // Stale but servable: refresh in the background, don't block.
      const waitUntil = ctx?.executionCtx?.waitUntil;
      if (waitUntil) {
        waitUntil(refresh());
      } else {
        // No background execution available (e.g. some dev paths):
        // fire and forget; the response still serves stale data.
        void refresh();
      }
      return {
        data: raw.data,
        cached: true,
        stale: true,
        fetchedAt: new Date(raw.fetchedAt).toISOString(),
      };
    }
    // Expired: fetch live, fall back to the expired value on failure.
    const fresh = await refresh();
    if (fresh) {
      return {
        data: fresh.data,
        cached: false,
        stale: false,
        fetchedAt: new Date(fresh.fetchedAt).toISOString(),
      };
    }
    return {
      data: raw.data,
      cached: true,
      stale: true,
      fetchedAt: new Date(raw.fetchedAt).toISOString(),
    };
  }

  const fresh = await refresh();
  if (!fresh) {
    throw new Error('Upstream fetch failed and nothing is cached yet.');
  }
  return {
    data: fresh.data,
    cached: false,
    stale: false,
    fetchedAt: new Date(fresh.fetchedAt).toISOString(),
  };
}
