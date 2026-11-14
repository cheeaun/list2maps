// GET /api/hours?fid=/g/...&name=...&lat=...&lng=...&cid1=...&cid2=...&tz=...
//
// One preview/place call per place via the server proxy, returning the
// parsed 7-day opening hours (plus the ChIJ place id when found).
// SWR-cached in KV keyed by the /g/ feature id: fresh 4h, stale served
// + background refresh up to 24h.
//
// Places without a /g/ feature id (custom pins) cannot have hours
// fetched — the client must not call this for them.

import { defineHandler } from 'void';
import { swrGet } from '../../src/lib/cache';
import { fetchPlaceHours } from '../../src/lib/google';

export const GET = defineHandler(async (c) => {
  const fid = c.req.query('fid');
  const name = c.req.query('name');
  const lat = c.req.query('lat');
  const lng = c.req.query('lng');
  const cid1 = c.req.query('cid1');
  const cid2 = c.req.query('cid2');
  const tz = c.req.query('tz') ?? 'Asia/Singapore';

  if (!fid || !name || lat === undefined || lng === undefined) {
    return c.json(
      {
        error:
          'Provide ?fid=/g/...&name=...&lat=...&lng=... (&cid1=&cid2=&tz=).',
      },
      400,
    );
  }
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
    return c.json({ error: 'lat/lng must be numbers.' }, 400);
  }

  try {
    const result = await swrGet(
      `hours:${fid}`,
      () =>
        fetchPlaceHours({
          fid,
          cid: [cid1 ?? null, cid2 ?? null],
          name,
          lat: latNum,
          lng: lngNum,
          timezone: tz,
        }),
      c,
    );
    return c.json({
      data: result.data,
      cached: result.cached,
      stale: result.stale,
      fetchedAt: result.fetchedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 502);
  }
});
