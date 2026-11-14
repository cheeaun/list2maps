// Shared types between the server proxy routes and the React client.

export interface PlaceEntry {
  position: number;
  name: string;
  address: string;
  fullAddress: string;
  lat: number | null;
  lng: number | null;
  /** Maps CID pair, decimal signed 64-bit strings (or null when missing). */
  cid: [string | null, string | null];
  /** "/g/..." feature id, or null (custom pins have none). */
  fid: string | null;
  missing: string[];
  /** ISO country code derived from coordinates/address, e.g. "SG". */
  country: string | null;
  /** IANA timezone for the place's country, e.g. "Asia/Singapore". */
  timezone: string | null;
}

export interface DayInterval {
  open: string; // "HH:MM" 24-hour
  close: string; // "HH:MM" 24-hour (mod 24h; see close_minutes for overnight)
  open_minutes: number; // minutes since midnight
  close_minutes: number; // minutes since midnight, +1440 when overnight
  overnight: boolean;
}

export interface OpeningHours {
  timezone: string;
  week_start: string; // ISO date
  week_end: string; // ISO date
  by_day: Record<string, DayInterval[]>; // monday..sunday
  text_by_day: Record<string, string>;
}

export interface PlaceHours {
  status: 'available' | 'not_listed';
  hours: OpeningHours | null;
  note: string;
  /** ChIJ place id when the detail response had one. */
  placeId: string | null;
}

export interface ListData {
  listId: string;
  title: string | null;
  count: number;
  fetchedAt: string; // ISO timestamp of the upstream fetch
  places: PlaceEntry[];
}

/** What the /api/list and /api/hours endpoints return. */
export interface ApiResult<T> {
  data: T;
  /** Served from the KV cache (fresh or stale). */
  cached: boolean;
  /** Served past the 4h freshness window; a background refresh was triggered. */
  stale: boolean;
  fetchedAt: string; // ISO timestamp of the data being served
}

export interface ListResponse extends ApiResult<ListData> {
  listId: string;
}

export type HoursResponse = ApiResult<PlaceHours>;
