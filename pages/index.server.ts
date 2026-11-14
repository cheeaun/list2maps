import { defineHandler, defineHead } from 'void';

// Client-mounted shell (no server-rendered map HTML); the loader just
// supplies the example lists. The map mounts in the browser.
export const ssr = false;

export const loader = defineHandler(async () => {
  return {
    examples: [
      {
        label: 'SG vegetarian eats (585 places)',
        url: 'https://maps.app.goo.gl/JbTrPGaEyfKGRdkQ6',
      },
      {
        label: 'SG public spaces — POPS (34 places)',
        url: 'https://maps.app.goo.gl/pqa6pHk9wDWgr5RP8',
      },
    ],
  };
});

export const head = defineHead(() => {
  return {
    title: 'OpenList — Google Maps lists on OpenFreeMap',
    meta: [
      {
        name: 'description',
        content:
          'Paste a Google Maps shared list link and see every place on OpenFreeMap, with search, open-now and open-at filters.',
      },
    ],
    link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
  };
});
