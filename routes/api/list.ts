// GET /api/list?url=<shared list link | list URL | list id>
//   or /api/list?id=<list id>
//
// Resolves the link to a Google Maps list id, fetches the whole list
// in one getlist call via the server proxy, and returns every place
// with name, address, coordinates, CID and /g/ feature id.
// SWR-cached in KV: fresh 4h, stale served + background refresh up to 24h.
//
// The short-link resolution itself is cached too (key `resolve:<url>`),
// so a repeated paste never re-fetches the redirect — and a list URL
// or bare id skips resolution entirely.

import { defineHandler } from 'void';
import { swrGet } from '../../src/lib/cache';
import { extractListId, fetchList, resolveListId } from '../../src/lib/google';

export const GET = defineHandler(async (c) => {
  const input = c.req.query('url') ?? c.req.query('id');
  if (!input) {
    return c.json(
      {
        error:
          'Provide ?url=<Google Maps shared list link> or ?id=<list id>.',
      },
      400,
    );
  }
  try {
    // A google.com/maps URL or bare id carries the list id directly.
    let listId = extractListId(input);
    if (!listId) {
      // A maps.app.goo.gl short link needs one redirect lookup; cache it.
      const resolved = await swrGet(
        `resolve:${input}`,
        () => resolveListId(input),
        c,
      );
      listId = resolved.data;
    }
    const result = await swrGet(`list:${listId}`, () => fetchList(listId), c);
    return c.json({
      listId,
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
