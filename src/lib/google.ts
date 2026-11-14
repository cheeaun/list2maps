// Google Maps shared-list proxy logic, ported from the proven
// Want-to-go regenerate script (reverse-engineered 2026-11-05, see
// ~/workspace/want-to-go-app/repo/reverse-engineering-notes.md).
//
// Two undocumented internal endpoints, free and keyless with only a
// browser User-Agent — but Google can change/block them, and bulk use
// is against Maps ToS. The official Places API (New) is the supported
// route. Rating / review count / category are NOT in either response.

import { countryAndTimezone } from './geo';
import type { ListData, OpeningHours, PlaceEntry, PlaceHours } from './types';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const GETLIST_URL = 'https://www.google.com/maps/preview/entitylist/getlist';
const PLACE_URL = 'https://www.google.com/maps/preview/place';

const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

// Hardcoded getlist pb (page size 2000 -> whole list in one call). If it
// fails, fetchList() falls back to extracting a fresh pb from the list
// page, exactly like the Python script.
const GETLIST_PB_TEMPLATE =
  '!1m6!1s{LIST_ID}' +
  '!2e3!3m1!1e1!3m1!1e9!2e2!3e2!4i2000' +
  '!6m3!1sZ23saobeI_TLvMcPq8XyIQ!15i204459!28e2!16b1';

// Place-details pb template, captured from the Seng Huat Mushroom Minced
// Meat Noodles place page (2026-11-05). Per-place values are swapped in
// by buildPlacePb(): the CID, the name, the lng/lat, and the /g/ id.
// The session token inside and the stale viewport value do NOT need
// updating (proven: this token worked for other places). A minimal
// hand-built pb returns 400, so the full template must be kept.
const PB_TEMPLATE =
  '!1m17!1s0x31da1172dd21a683:0x19c826d75529766' +
  '!2sSeng+Huat+Mushroom+Minced+Meat+Noodles' +
  '!3m8!1m3!1d3988.6530138315447!2d103.7433564!3d1.3848149' +
  '!3m2!1i1024!2i768!4f13.1!4m2!3d1.3848149!4d103.7433564' +
  '!15m2!1m1!4s/g/11j2__w6jy' +
  '!12m4!2m3!1i360!2i120!4i8!13m57!2m2!1i203!2i100!3m2!2i4!5b1' +
  '!6m6!1m2!1i86!2i86!1m2!1i408!2i240' +
  '!7m33!1m3!1e1!2b0!3e3!1m3!1e2!2b1!3e2!1m3!1e2!2b0!3e3' +
  '!1m3!1e8!2b0!3e3!1m3!1e10!2b0!3e3!1m3!1e10!2b1!3e2' +
  '!1m3!1e10!2b0!3e4!1m3!1e9!2b1!3e2!2b1!9b0' +
  '!15m8!1m7!1m2!1m1!1e2!2m2!1i195!2i195!3i20' +
  '!14m3!1sb27saq-NKNXdptQPo7LciAU!7e81!15i10112' +
  '!15m108!1m26!13m9!2b1!3b1!4b1!6i1!8b1!9b1!14b1!20b1!25b1' +
  '!18m15!3b1!4b1!5b1!6b1!13b1!14b1!17b1!21b1!22b1!30b1!32b1' +
  '!33m1!1b1!34b1!36e2!10m1!8e3!11m1!3e1!17b1!20m2!1e3!1e6' +
  '!24b1!25b1!26b1!27b1!29b1!30m1!2b1!36b1!37b1' +
  '!39m3!2m2!2i1!3i1!43b1!52b1!54m1!1b1!55b1!56m1!1b1' +
  '!61m2!1m1!1e1!65m5!3m4!1m3!1m2!1i224!2i298' +
  '!72m22!1m8!2b1!5b1!7b1!12m4!1b1!2b1!4m1!1e1!4b1' +
  '!8m10!1m6!4m1!1e1!4m1!1e3!4m1!1e4' +
  '!3sother_user_google_review_posts__and__hotel_and_vr_partner_review_posts' +
  '!6m1!1e1!9b1!89b1!90m2!1m1!1e2!98m3!1b1!2b1!3b1' +
  '!103b1!113b1!114m3!1b1!2m1!1b1!117b1!122m1!1b1!126b1!127b1' +
  '!128m1!1b1!21m0!22m1!1e81!30m8!3b1!6m2!1b1!2b1!7m2!1e3!2b1' +
  '!9b1!34m5!7b1!10b1!14b1!15m1!1b0!37i802';

async function getJson(url: string, useBrowserUa = true): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip',
  };
  if (useBrowserUa) headers['User-Agent'] = UA;
  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    throw new Error(`Google returned HTTP ${resp.status} for ${url}`);
  }
  // fetch() decompresses gzip automatically (unlike urllib).
  let text = await resp.text();
  if (text.startsWith(")]}'")) {
    text = text.slice(4).replace(/^\n/, '');
  }
  return JSON.parse(text);
}

/** Extract the list id from a google.com/maps list URL or a bare id. */
export function extractListId(input: string): string | null {
  const m = input.match(/!11m2!2s([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{10,}$/.test(input.trim())) return input.trim();
  return null;
}

/**
 * Resolve any shared-list reference to a list id: a maps.app.goo.gl
 * short link, a google.com/maps list URL, or a bare list id.
 *
 * Short links MUST be fetched with no browser User-Agent: with one,
 * Google serves a 39KB JS interstitial page instead of the 302 that
 * carries the list id in its Location header (verified 2026-11-14).
 */
export async function resolveListId(input: string): Promise<string> {
  const trimmed = input.trim();
  const direct = extractListId(trimmed);
  if (direct) return direct;
  // Short link (or anything else): fetch without following redirects,
  // read the Location header.
  const resp = await fetch(trimmed, { redirect: 'manual' });
  const loc = resp.headers.get('location') ?? '';
  const fromRedirect = extractListId(loc);
  if (fromRedirect) return fromRedirect;
  // Some short links answer 200 with a JS redirect page; the deep link
  // is in the body.
  if (resp.ok) {
    const body = await resp.text();
    const m = body.match(/https:\/\/www\.google\.com\/maps[^"'\\ ]+/);
    if (m) {
      const fromBody = extractListId(m[0]);
      if (fromBody) return fromBody;
    }
  }
  throw new Error(
    'Could not find a Google Maps list in that link. Paste a maps.app.goo.gl link, a google.com/maps list URL, or a bare list id.',
  );
}

function listPageUrl(listId: string): string {
  return (
    'https://www.google.com/maps/@/data=!3m1!4b1!4m3!11m2!2s' +
    listId +
    '!3e2?entry=tts'
  );
}

async function fetchListEntries(listId: string): Promise<unknown[]> {
  const pb = GETLIST_PB_TEMPLATE.replace('{LIST_ID}', listId);
  const url =
    GETLIST_URL +
    '?authuser=0&hl=en&gl=us&pb=' +
    encodeURIComponent(pb);
  try {
    const data = (await getJson(url)) as unknown[];
    return (data[0] as unknown[])[8] as unknown[];
  } catch (err) {
    // Hardcoded pb may have gone stale; extract a fresh one from the
    // list page, as the Python script does.
    const htmlResp = await fetch(listPageUrl(listId), {
      headers: { 'User-Agent': UA },
    });
    const html = await htmlResp.text();
    const m = html.match(
      /\/maps\/preview\/entitylist\/getlist\?[^"\\]*?&pb=([^"\\]+)/,
    );
    if (!m) throw err;
    let freshPb = decodeURIComponent(m[1]).replace('!4i500', '!4i2000');
    if (!freshPb.includes(listId)) {
      freshPb = freshPb.replace(/!1s[A-Za-z0-9_-]+/, `!1s${listId}`);
    }
    const retryUrl =
      GETLIST_URL +
      '?authuser=0&hl=en&gl=us&pb=' +
      encodeURIComponent(freshPb);
    const data = (await getJson(retryUrl)) as unknown[];
    return (data[0] as unknown[])[8] as unknown[];
  }
}

/** Best-effort list title from the list page's HTML. */
export async function fetchListTitle(listId: string): Promise<string | null> {
  try {
    const resp = await fetch(listPageUrl(listId), {
      headers: { 'User-Agent': UA },
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    const og = html.match(
      /<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i,
    );
    if (og) {
      const title = decodeHtml(og[1]);
      return title === 'Google Maps' ? null : title;
    }
    const title = html.match(/<title>([^<]+)<\/title>/i);
    if (title) {
      const clean = decodeHtml(title[1].replace(/ - Google Maps$/, ''));
      return clean === 'Google Maps' ? null : clean;
    }
    return null;
  } catch {
    return null;
  }
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function at<T>(lst: unknown, i: number, fallback: T | null = null): T | null {
  if (Array.isArray(lst) && lst.length > i) return lst[i] as T;
  return fallback;
}

function parseListEntry(entry: unknown, position: number): PlaceEntry {
  const name = at<string>(entry, 2, '') ?? '';
  let place: unknown[] = [];
  const p = at(entry, 1);
  if (Array.isArray(p)) place = p;
  const fullAddress = at<string>(place, 2, '') ?? '';
  const shortAddress = at<string>(place, 4, '') ?? fullAddress;
  const coords = at(place, 5);
  let lat =
    Array.isArray(coords) ? ((at<number>(coords, 2) as number | null) ?? null) : null;
  let lng =
    Array.isArray(coords) ? ((at<number>(coords, 3) as number | null) ?? null) : null;
  // Google emits exactly 0,0 for places with no coordinates (null
  // island). No real shared-list place sits there; treat it as missing
  // or fitBounds / markers would span the whole world.
  if (lat === 0 && lng === 0) {
    lat = null;
    lng = null;
  }
  const cidPair = at(place, 6);
  const cid: [string | null, string | null] =
    Array.isArray(cidPair) && cidPair.length >= 2
      ? [String(cidPair[0]), String(cidPair[1])]
      : [null, null];
  const fid = at<string>(place, 7);
  const missing: string[] = [];
  if (lat === null || lng === null) missing.push('coordinates');
  if (cid[0] === null || cid[1] === null) missing.push('CID');
  if (!fid) missing.push('/g/ feature id');
  const { country, timezone } = countryAndTimezone(
    lat,
    lng,
    shortAddress || fullAddress,
  );
  return {
    position,
    name,
    address: shortAddress || fullAddress,
    fullAddress,
    lat,
    lng,
    cid,
    fid: fid ?? null,
    missing,
    country,
    timezone,
  };
}

/** One getlist call -> the whole list, in list order. */
export async function fetchList(listId: string): Promise<ListData> {
  const rawEntries = await fetchListEntries(listId);
  const places = rawEntries.map((e, i) => parseListEntry(e, i + 1));
  const title = await fetchListTitle(listId);
  return {
    listId,
    title,
    count: places.length,
    fetchedAt: new Date().toISOString(),
    places,
  };
}

function toHex(n: string): string {
  // Signed 64-bit decimal -> unsigned hex (Maps CID format).
  return (BigInt(n) & ((1n << 64n) - 1n)).toString(16);
}

function buildPlacePb(place: {
  cid: [string | null, string | null];
  name: string;
  lat: number | null;
  lng: number | null;
  fid: string | null;
}): string {
  const cid = `0x${toHex(place.cid[0]!)}:0x${toHex(place.cid[1]!)}`;
  return PB_TEMPLATE.replace(
    '0x31da1172dd21a683:0x19c826d75529766',
    cid,
  )
    .replace(
      'Seng+Huat+Mushroom+Minced+Meat+Noodles',
      encodeURIComponent(place.name),
    )
    .replaceAll('103.7433564', String(place.lng))
    .replaceAll('1.3848149', String(place.lat))
    .replace('/g/11j2__w6jy', place.fid!);
}

function findDayRows(node: unknown, out: unknown[][]): void {
  if (Array.isArray(node)) {
    if (
      node.length >= 4 &&
      typeof node[0] === 'string' &&
      WEEKDAYS.includes(node[0].toLowerCase()) &&
      typeof node[1] === 'number' &&
      node[1] >= 1 &&
      node[1] <= 7 &&
      Array.isArray(node[2]) &&
      node[2].length === 3 &&
      node[2].every((x) => typeof x === 'number') &&
      (node[2][0] as number) >= 2020 &&
      (node[2][0] as number) <= 2100
    ) {
      out.push(node as unknown[]);
    } else {
      for (const child of node) findDayRows(child, out);
    }
  } else if (node && typeof node === 'object') {
    for (const child of Object.values(node)) findDayRows(child, out);
  }
}

function fmtMinutes(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function normalizeText(text: string): string {
  return text
    .replace(/[\u202f\u00a0]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ AM/g, 'am')
    .replace(/ PM/g, 'pm')
    .replace(/ – /g, '–')
    .replace(/ - /g, '–');
}

function weekdayName(date: Date): string {
  // JS getDay(): Sunday=0..Saturday=6; WEEKDAYS is Monday-first.
  return WEEKDAYS[(date.getDay() + 6) % 7];
}

/**
 * Detail JSON -> parsed opening hours. Ported from parse_hours in the
 * Python script, including its defences: malformed interval pairs
 * (empty close side) are skipped, never fatal.
 */
export function parseHours(
  detail: unknown,
  timezone: string,
): { hours: OpeningHours | null; note: string; placeId: string | null } {
  // ChIJ place id, anywhere in the response.
  let placeId: string | null = null;
  const findPlaceId = (node: unknown): void => {
    if (placeId) return;
    if (typeof node === 'string') {
      const m = node.match(/ChIJ[0-9A-Za-z_-]{20,}/);
      if (m) placeId = m[0];
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) findPlaceId(child);
    } else if (node && typeof node === 'object') {
      for (const child of Object.values(node)) findPlaceId(child);
    }
  };
  findPlaceId(detail);

  const rows: unknown[][] = [];
  findDayRows(detail, rows);
  const byDate = new Map<string, unknown[]>();
  for (const row of rows) {
    const [y, m, d] = row[2] as number[];
    const key = `${y}-${m}-${d}`;
    if (!byDate.has(key)) byDate.set(key, row);
  }
  if (byDate.size === 0) return { hours: null, note: '', placeId };
  const dates = [...byDate.keys()]
    .map((k) => k.split('-').map(Number) as [number, number, number])
    .sort((a, b) => +new Date(a[0], a[1] - 1, a[2]) - +new Date(b[0], b[1] - 1, b[2]))
    .slice(0, 7);

  const byDay: Record<string, { open: string; close: string; open_minutes: number; close_minutes: number; overnight: boolean }[]> = {};
  const textByDay: Record<string, string> = {};
  const holidayDays: Record<string, string[]> = {};
  for (const [y, m, d] of dates) {
    const row = byDate.get(`${y}-${m}-${d}`)!;
    const date = new Date(y, m - 1, d);
    const weekday = weekdayName(date);
    const intervals: { open: string; close: string; open_minutes: number; close_minutes: number; overnight: boolean }[] = [];
    const texts: string[] = [];
    const items = (row[3] as unknown[]) ?? [];
    for (const item of items) {
      if (!Array.isArray(item) || item.length === 0) continue;
      const text = item[0] as string;
      if (text === 'Closed') continue;
      if (text === 'Open 24 hours') {
        intervals.push({
          open: '00:00',
          close: '24:00',
          open_minutes: 0,
          close_minutes: 1440,
          overnight: false,
        });
        texts.push('Open 24 hours');
        continue;
      }
      if (item.length < 2 || !item[1]) continue;
      let pairs = item[1] as unknown;
      if (
        Array.isArray(pairs) &&
        pairs.length > 0 &&
        Array.isArray(pairs[0]) &&
        pairs[0].length > 0 &&
        typeof pairs[0][0] === 'number'
      ) {
        pairs = [pairs];
      }
      if (!Array.isArray(pairs)) continue;
      for (const pair of pairs as unknown[]) {
        if (!Array.isArray(pair) || pair.length !== 2) continue;
        const [o, c] = pair as unknown[];
        if (
          !Array.isArray(o) ||
          o.length === 0 ||
          typeof o[0] !== 'number' ||
          !Array.isArray(c) ||
          c.length === 0 ||
          typeof c[0] !== 'number'
        ) {
          continue;
        }
        const oh = o[0] as number;
        const om = o.length > 1 ? (o[1] as number) : 0;
        const ch = c[0] as number;
        const cm = c.length > 1 ? (c[1] as number) : 0;
        const openMin = oh * 60 + om;
        let closeMin = ch * 60 + cm;
        let overnight = false;
        if (closeMin <= openMin) {
          closeMin += 1440;
          overnight = true;
        }
        intervals.push({
          open: fmtMinutes(openMin % 1440),
          close: fmtMinutes(closeMin % 1440),
          open_minutes: openMin,
          close_minutes: closeMin,
          overnight,
        });
      }
      texts.push(normalizeText(text));
    }
    byDay[weekday] = intervals;
    textByDay[weekday] = texts.length > 0 ? texts.join(', ') : 'Closed';
    for (const extra of row.slice(5)) {
      if (
        Array.isArray(extra) &&
        extra.length >= 2 &&
        typeof extra[0] === 'string' &&
        extra[0].includes('might affect')
      ) {
        const label = String(extra[1]);
        (holidayDays[label] ??= []).push(
          weekday.charAt(0).toUpperCase() + weekday.slice(1),
        );
      }
    }
  }
  const weekStart = new Date(dates[0][0], dates[0][1] - 1, dates[0][2]);
  const weekEnd = new Date(
    dates[dates.length - 1][0],
    dates[dates.length - 1][1] - 1,
    dates[dates.length - 1][2],
  );
  const iso = (dt: Date) => dt.toISOString().slice(0, 10);
  let note = '';
  const labels = Object.keys(holidayDays);
  if (labels.length > 0) {
    note = labels
      .map(
        (label) =>
          `Hours might differ (${label}) on ${holidayDays[label].join(', ')}`,
      )
      .join('; ');
  }
  return {
    hours: {
      timezone,
      week_start: iso(weekStart),
      week_end: iso(weekEnd),
      by_day: byDay,
      text_by_day: textByDay,
    },
    note,
    placeId,
  };
}

export interface HoursRequest {
  fid: string;
  cid: [string | null, string | null];
  name: string;
  lat: number | null;
  lng: number | null;
  timezone: string;
}

/** One preview/place call -> parsed hours for one place. */
export async function fetchPlaceHours(req: HoursRequest): Promise<PlaceHours> {
  const pb = buildPlacePb(req);
  const url =
    PLACE_URL +
    '?authuser=0&hl=en&gl=us&q=' +
    encodeURIComponent(req.name) +
    '&pb=' +
    encodeURIComponent(pb);
  const detail = await getJson(url);
  const { hours, note, placeId } = parseHours(detail, req.timezone);
  if (!hours) {
    return { status: 'not_listed', hours: null, note, placeId };
  }
  return { status: 'available', hours, note, placeId };
}
