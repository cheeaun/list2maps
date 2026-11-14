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
    title: 'List2Maps — turn a Google Maps list into a map',
    meta: [
      {
        name: 'description',
        content:
          'Paste a Google Maps shared list link and get every place on OpenFreeMap — searchable, with open-now and open-at filters, GeoJSON and CSV export. No account, no API key.',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
    ],
    link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
  };
});
