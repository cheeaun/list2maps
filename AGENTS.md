<!--injected-by-void-v1.9.1-->
## Void

- This project uses [Void](https://void.cloud), a full-stack Vite framework for Cloudflare Workers with file-based API routing, server-rendered pages, and typed backend services.
- Use Void's CLI and typed APIs. Before working with Void, read the relevant Markdown docs in `node_modules/void/docs/`; start with `guide/quickstart.md` for setup and `reference/cli.md` for commands.

<!--/injected-by-void-->

# List2Maps

Turn any Google Maps shared list into a fast, filterable map on
OpenFreeMap. Void (Vite + React) on Cloudflare Workers. See
`README.md` for the user-facing story; this file is the working
manual for the next session.

## Architecture

- `pages/index.tsx` — the whole client: MapLibre map (clustered
  GeoJSON source), filters, list sidebar, detail panel, export.
  Client-mounted shell (`ssr = false` in `pages/index.server.ts`).
- `routes/api/list.ts` — `GET /api/list?url=…`: resolves a
  `maps.app.goo.gl` short link (no browser User-Agent — with one,
  Google serves a JS interstitial instead of the 302 carrying the
  list id), then one `getlist` call for the whole list.
- `routes/api/hours.ts` — `GET /api/hours?fid=…`: one
  `preview/place` call per place, 7-day hours + ChIJ place id.
- `src/lib/google.ts` — resolve + getlist + preview/place + hours
  parser. Ported from the proven Want-to-go regenerate script.
- `src/lib/cache.ts` — SWR over `void/kv`: 4h fresh, 24h stale with
  background refresh via `executionCtx.waitUntil`.
- `src/lib/geo.ts` — country + IANA timezone from coordinates.
- `src/lib/time.ts` — open-now / open-at evaluation per timezone.
- `routes/api/debug-seed.dev.ts` — dev-only KV seeding (`.dev`
  suffix, never ships).

## Data source caveats

- The list/hours endpoints are Google Maps' **undocumented internal
  endpoints** (against Maps ToS; caveat is in the UI fine print and
  the README). Rating, review count and category are NOT in either
  response — never claim to show or filter by them.
- Hours are always the current week; the pb template can go stale —
  see the README's caveat section for the refresh procedure.

## Conventions and lessons (learned the hard way)

- **Google emits exactly `0,0` for places with no coordinates.**
  `parseListEntry` nulls 0,0 and the client `hasCoords` helper
  double-guards it. Without this, `fitBounds` spans the whole world
  and a marker sits on null island.
- **Map data must flow through a ref, not a mount-time closure.**
  The `load` / `style.load` handlers are created once; they read the
  latest filtered places via `filteredRef` and a shared `pushData`,
  so data lands whichever of style-load / list-load wins the race.
  A stale-closure version of this shipped empty markers.
- **Vite dev needs `optimizeDeps.exclude: ['maplibre-gl']`** — the
  dep optimizer doesn't pre-bundle MapLibre's worker, so in dev the
  worker URL 404s and the map stays blank. Production build bundles
  the worker fine either way.
- **Mobile layout is stacked, not fixed-height.** Desktop is
  `100dvh` with an internally scrolling sidebar; on mobile
  (`max-width: 760px`) the app grows with its content (map 52dvh on
  top, list below, page scrolls) and the page carries a real
  `viewport` meta tag. Inputs are 16px on mobile so iOS doesn't
  auto-zoom on tap.
- **Short links must be fetched with no browser User-Agent.**
- **A fix is not done until it has been verified against real data.**
  Run `scripts/seed-dev.sh` (Node harness → seeds the dev KV), then
  screenshot-check the affected views in headless Chromium — never
  ask Chee to be the first pair of eyes. The stock Playwright
  Chromium build works for this (the Hatch browser blocks loopback
  navigation); see `scripts/harness/` and the verification captures
  in `verify-*.png`.

## Local verification environment

- workerd in this sandbox **cannot fetch the internet** (its TLS
  ignores the egress proxy). Local dev therefore runs on seeded KV
  data; a deployed Worker fetches directly. Never present this as an
  app bug.
- Headless screenshots need a forward proxy for tiles
  (`/tmp/shot/proxy.mjs` → egress proxy) and
  `--ignore-certificate-errors` (the proxy MITMs TLS). The proxy
  wedges under tile bursts — restart it if style/tile fetches start
  timing out while direct curl works.
- `/tmp` is a 512 MB tmpfs: keep big downloads (browser binaries)
  under `~/shot-work`, not `/tmp`.
- `pkill -f` patterns must use the `[x]` bracket trick AND must not
  appear literally elsewhere in the same command line, or the pkill
  kills its own shell.

