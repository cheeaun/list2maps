// Client-side hours fetching against the /api/hours proxy route.

import type { PlaceEntry, PlaceHours } from './types';

/** One place's hours via the proxy (server caches each place 4h). */
export async function fetchHours(place: PlaceEntry): Promise<PlaceHours> {
  const q = new URLSearchParams({
    fid: place.fid!,
    name: place.name,
    lat: String(place.lat),
    lng: String(place.lng),
    tz: place.timezone ?? 'Asia/Singapore',
  });
  if (place.cid[0]) q.set('cid1', place.cid[0]);
  if (place.cid[1]) q.set('cid2', place.cid[1]);
  const r = await fetch(`/api/hours?${q.toString()}`);
  const j = (await r.json()) as { error?: string; data?: PlaceHours };
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j.data as PlaceHours;
}

const NOT_LISTED: PlaceHours = {
  status: 'not_listed',
  hours: null,
  note: '',
  placeId: null,
};

export interface BatchProgress {
  done: number;
  total: number;
}

/**
 * Fetch hours for every place that has a /g/ id and no result yet,
 * with bounded concurrency. Failures are recorded as not_listed so a
 * flaky place can't stall the batch (a reload retries via the server,
 * which has its own cache). Calls onProgress after each place.
 */
export async function fetchHoursBatch(
  places: PlaceEntry[],
  known: Record<string, PlaceHours>,
  opts: {
    concurrency?: number;
    onProgress?: (p: BatchProgress) => void;
    isCancelled?: () => boolean;
  } = {},
): Promise<Record<string, PlaceHours>> {
  const concurrency = opts.concurrency ?? 8;
  const todo = places.filter((p) => p.fid && !known[p.fid]);
  const total = todo.length;
  let done = 0;
  const results: Record<string, PlaceHours> = { ...known };
  const queue = [...todo];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      if (opts.isCancelled?.()) return;
      const place = queue.shift()!;
      try {
        results[place.fid!] = await fetchHours(place);
      } catch {
        results[place.fid!] = NOT_LISTED;
      }
      done += 1;
      opts.onProgress?.({ done, total });
    }
  });
  await Promise.all(workers);
  return results;
}
