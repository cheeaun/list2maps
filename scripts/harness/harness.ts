// Node harness: run the REAL server lib (src/lib/google.ts +
// src/lib/cache.ts) against live Google data, via Node fetch (which
// honours the sandbox egress proxy). Also dumps the KV envelopes so
// the dev server's KV can be seeded for client/map verification.
import { writeFileSync } from 'node:fs';
import { fetchList, fetchPlaceHours, resolveListId } from '../../src/lib/google';
import { swrGet } from '../../src/lib/cache';
import { store } from './kv-stub';

const SHORT1 = 'https://maps.app.goo.gl/JbTrPGaEyfKGRdkQ6';
const SHORT2 = 'https://maps.app.goo.gl/pqa6pHk9wDWgr5RP8';

async function main() {
  // --- resolve ---
  const id1 = await resolveListId(SHORT1);
  const id2 = await resolveListId(SHORT2);
  console.log('resolved:', id1, '|', id2);

  // --- list 1 (live, then cached) ---
  const r1 = await swrGet(`list:${id1}`, () => fetchList(id1));
  console.log(`list1: count=${r1.data.count} title=${JSON.stringify(r1.data.title)} cached=${r1.cached} stale=${r1.stale}`);
  console.log('  first:', r1.data.places[0].name, '|', r1.data.places[0].address, '|', r1.data.places[0].lat, r1.data.places[0].lng, '|', r1.data.places[0].fid);
  console.log('  with coords:', r1.data.places.filter((p) => p.lat !== null).length,
    'with fid:', r1.data.places.filter((p) => p.fid).length,
    'countries:', [...new Set(r1.data.places.map((p) => p.country))].join(','));
  const r1b = await swrGet(`list:${id1}`, () => fetchList(id1));
  console.log('list1 again: cached=' + r1b.cached + ' (expect true)');

  // --- list 2 (custom pins, no fids) ---
  const r2 = await swrGet(`list:${id2}`, () => fetchList(id2));
  console.log(`list2: count=${r2.data.count} title=${JSON.stringify(r2.data.title)} cached=${r2.cached}`);
  console.log('  first:', r2.data.places[0].name, '| fid:', r2.data.places[0].fid, '| missing:', r2.data.places[0].missing.join(','));
  console.log('  with fid:', r2.data.places.filter((p) => p.fid).length);

  // --- hours for 3 places from list 1 ---
  for (const place of r1.data.places.slice(0, 3)) {
    const h = await swrGet(
      `hours:${place.fid}`,
      () =>
        fetchPlaceHours({
          fid: place.fid!,
          cid: place.cid,
          name: place.name,
          lat: place.lat,
          lng: place.lng,
          timezone: place.timezone ?? 'Asia/Singapore',
        }),
    );
    console.log(`hours ${place.name}: status=${h.data.status} placeId=${h.data.placeId} cached=${h.cached}`);
    if (h.data.hours) {
      console.log('  week:', h.data.hours.week_start, '->', h.data.hours.week_end);
      for (const d of ['monday', 'saturday', 'sunday']) {
        console.log(`  ${d}: ${h.data.hours.text_by_day[d] ?? '—'}`);
      }
      if (h.data.note) console.log('  note:', h.data.note);
    }
  }
  const hAgain = await swrGet(`hours:${r1.data.places[0].fid}`, () => { throw new Error('should not refetch'); });
  console.log('hours again: cached=' + hAgain.cached + ' (expect true)');

  // --- dump one manifest (key -> KV envelope) for seeding the dev server ---
  const manifest: Record<string, unknown> = {};
  for (const [key, entry] of store) manifest[key] = entry.value;
  manifest[`resolve:${SHORT1}`] = { fetchedAt: Date.now(), data: id1 };
  manifest[`resolve:${SHORT2}`] = { fetchedAt: Date.now(), data: id2 };
  writeFileSync('./fixtures-manifest.json', JSON.stringify(manifest, null, 2));
  console.log('dumped manifest with', Object.keys(manifest).length, 'keys');
}

main().catch((e) => {
  console.error('HARNESS FAILED:', e);
  process.exit(1);
});
