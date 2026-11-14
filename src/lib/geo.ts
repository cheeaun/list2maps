// Country / timezone derivation from coordinates.
// Ported from the Want-to-go regenerate script (proven 2026-11-07):
// the short address often omits the country entirely, so coordinates
// are the reliable signal.

export const COUNTRY_TIMEZONES: Record<string, string> = {
  JP: 'Asia/Tokyo',
  TH: 'Asia/Bangkok',
  MO: 'Asia/Macau',
  HK: 'Asia/Hong_Kong',
  TW: 'Asia/Taipei',
  MY: 'Asia/Kuala_Lumpur',
  VN: 'Asia/Ho_Chi_Minh',
  GB: 'Europe/London',
  NL: 'Europe/Amsterdam',
  SG: 'Asia/Singapore',
  KR: 'Asia/Seoul',
  ID: 'Asia/Jakarta',
  AU: 'Australia/Sydney',
  US: 'America/New_York',
  FR: 'Europe/Paris',
  IT: 'Europe/Rome',
  ES: 'Europe/Madrid',
};

const SG_LAT_MIN = 1.2;
const SG_LAT_MAX = 1.5;
const SG_LNG_MIN = 103.55;
const SG_LNG_MAX = 104.15;

// Country bounding boxes (lat_min, lat_max, lng_min, lng_max).
// Hong Kong and Macau first — they sit inside broader China boxes.
const COUNTRY_BBOXES: Array<[string, number, number, number, number]> = [
  ['HK', 22.15, 22.6, 113.8, 114.5],
  ['MO', 22.1, 22.25, 113.5, 113.65],
  ['JP', 30.0, 46.0, 129.0, 146.0],
  ['TH', 5.0, 21.0, 97.0, 106.0],
  ['TW', 21.9, 25.4, 119.9, 122.1],
  ['MY', 0.8, 7.5, 99.5, 105.0],
  ['VN', 8.0, 23.4, 102.1, 109.6],
  ['GB', 49.9, 58.7, -5.7, 1.8],
  ['NL', 50.7, 53.6, 3.3, 7.2],
];

export function countryFromCoords(
  lat: number | null,
  lng: number | null,
): string | null {
  if (lat === null || lng === null) return null;
  if (
    lat >= SG_LAT_MIN &&
    lat <= SG_LAT_MAX &&
    lng >= SG_LNG_MIN &&
    lng <= SG_LNG_MAX
  ) {
    return 'SG';
  }
  for (const [code, laMin, laMax, lnMin, lnMax] of COUNTRY_BBOXES) {
    if (lat >= laMin && lat <= laMax && lng >= lnMin && lng <= lnMax) {
      return code;
    }
  }
  return null;
}

const COUNTRY_NAMES: Record<string, string> = {
  japan: 'JP',
  thailand: 'TH',
  macao: 'MO',
  macau: 'MO',
  'hong kong': 'HK',
  taiwan: 'TW',
  malaysia: 'MY',
  vietnam: 'VN',
  'united kingdom': 'GB',
  netherlands: 'NL',
  singapore: 'SG',
  'south korea': 'KR',
  indonesia: 'ID',
  australia: 'AU',
  'united states': 'US',
  france: 'FR',
  italy: 'IT',
  spain: 'ES',
};

export function countryFromAddress(address: string): string | null {
  const parts = address
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  for (const part of parts) {
    const code = COUNTRY_NAMES[part.toLowerCase()];
    if (code) return code;
  }
  return null;
}

/** Country code, then IANA timezone — coordinates first, address fallback. */
export function countryAndTimezone(
  lat: number | null,
  lng: number | null,
  address: string,
): { country: string | null; timezone: string | null } {
  const country =
    countryFromCoords(lat, lng) ?? countryFromAddress(address);
  return {
    country,
    timezone: country ? (COUNTRY_TIMEZONES[country] ?? null) : null,
  };
}
