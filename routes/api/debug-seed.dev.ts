// Dev-only route: seed the local KV cache with a pre-fetched envelope.
// Lets the client and map be verified end to end in local dev, where
// workerd cannot reach the internet (sandbox egress proxy). Never ships:
// `.dev` routes run in development only.
//
// POST /api/debug-seed  { "key": "list:<id>", "value": {fetchedAt, data} }
import { defineHandler } from 'void';
import { kv } from 'void/kv';

export const POST = defineHandler(async (c) => {
  const body = (await c.req.json()) as {
    key?: string;
    value?: unknown;
    ttl?: number;
  };
  if (!body.key || body.value === undefined) {
    return c.json({ error: 'Provide { key, value }.' }, 400);
  }
  await kv.put(body.key, body.value, { ttl: body.ttl ?? 86400 });
  return c.json({ ok: true, key: body.key });
});
