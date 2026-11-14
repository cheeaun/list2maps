// Temporary debug route: is outbound fetch from workerd working at all?
import { defineHandler } from 'void';

export const GET = defineHandler(async (c) => {
  const target = c.req.query('u') ?? 'https://example.com';
  try {
    const r = await fetch(target, { redirect: 'manual' });
    const text = await r.text();
    return c.json({
      ok: true,
      status: r.status,
      location: r.headers.get('location'),
      bodyStart: text.slice(0, 120),
    });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 502);
  }
});
