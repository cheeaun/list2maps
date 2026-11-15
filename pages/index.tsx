import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { InferProps } from 'void';
import type { loader } from './index.server';
import type { ListData, PlaceEntry, PlaceHours } from '../src/lib/types';
import { fetchHours, fetchHoursBatch } from '../src/lib/hours-client';
import {
  WEEKDAYS,
  isOpenAt,
  openStatusNow,
  partsInTz,
} from '../src/lib/time';
import '../src/styles.css';

type Props = InferProps<typeof loader>;

const STYLES = [
  {
    id: 'liberty',
    label: 'Liberty',
    url: 'https://tiles.openfreemap.org/styles/liberty',
  },
  {
    id: 'bright',
    label: 'Bright',
    url: 'https://tiles.openfreemap.org/styles/bright',
  },
  {
    id: 'positron',
    label: 'Positron',
    url: 'https://tiles.openfreemap.org/styles/positron',
  },
  {
    id: 'fiord',
    label: 'Fiord (dark)',
    url: 'https://tiles.openfreemap.org/styles/fiord',
  },
];

const SINGAPORE: [number, number] = [103.85, 1.29];

type TimeMode = 'any' | 'now' | 'at';

// A place is mappable only with real coordinates. The server already
// nulls 0,0 (Google's no-coordinates marker); this also guards against
// a stale cached entry that still carries it.
function hasCoords(p: PlaceEntry): boolean {
  return p.lat !== null && p.lng !== null && !(p.lat === 0 && p.lng === 0);
}

function googleMapsLink(place: PlaceEntry, placeId: string | null): string {
  if (placeId) {
    return (
      'https://www.google.com/maps/search/?api=1&query=' +
      encodeURIComponent(place.name) +
      '&query_place_id=' +
      placeId
    );
  }
  if (place.lat !== null && place.lng !== null) {
    return (
      'https://www.google.com/maps/search/?api=1&query=' +
      `${place.lat},${place.lng}`
    );
  }
  return (
    'https://www.google.com/maps/search/?api=1&query=' +
    encodeURIComponent(`${place.name} ${place.address}`)
  );
}

function toFeature(place: PlaceEntry) {
  return {
    type: 'Feature' as const,
    geometry: {
      type: 'Point' as const,
      coordinates: [place.lng, place.lat] as [number, number],
    },
    properties: { position: place.position, name: place.name },
  };
}

export default function IndexPage({ examples }: Props) {
  const [input, setInput] = useState('');
  const [list, setList] = useState<ListData | null>(null);
  const [cacheState, setCacheState] = useState<{
    cached: boolean;
    stale: boolean;
    fetchedAt: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [country, setCountry] = useState('all');
  const [timeMode, setTimeMode] = useState<TimeMode>('any');
  const [openAt, setOpenAt] = useState({ day: 'today', time: '17:00', duration: 1 });
  const [sort, setSort] = useState<'list' | 'name'>('list');
  const [selected, setSelected] = useState<PlaceEntry | null>(null);
  const [styleId, setStyleId] = useState('liberty');

  const [hoursByFid, setHoursByFid] = useState<Record<string, PlaceHours>>({});
  const hoursRef = useRef<Record<string, PlaceHours>>({});
  const [hoursProgress, setHoursProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const hoursFetchingRef = useRef(false);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const selectedRef = useRef<PlaceEntry | null>(null);
  selectedRef.current = selected;
  // Latest filtered places, for map handlers created once on mount.
  const filteredRef = useRef<PlaceEntry[]>([]);

  // ---- data loading ----

  const loadList = useCallback(async (url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setSelected(null);
    setHoursByFid({});
    hoursRef.current = {};
    setHoursProgress(null);
    try {
      const r = await fetch(`/api/list?url=${encodeURIComponent(trimmed)}`);
      const j = (await r.json()) as {
        error?: string;
        data?: ListData;
        cached?: boolean;
        stale?: boolean;
        fetchedAt?: string;
      };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setList(j.data as ListData);
      setCacheState({
        cached: j.cached ?? false,
        stale: j.stale ?? false,
        fetchedAt: j.fetchedAt ?? new Date().toISOString(),
      });
      setCountry('all');
      setQuery('');
      setTimeMode('any');
      const next = new URL(window.location.href);
      next.searchParams.set('list', trimmed);
      window.history.replaceState(null, '', next.toString());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setList(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-load from ?list= on first visit.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('list') ?? params.get('url');
    if (fromUrl) {
      setInput(fromUrl);
      void loadList(fromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ensureHours = useCallback(async (places: PlaceEntry[]) => {
    if (hoursFetchingRef.current) return;
    const missing = places.filter((p) => p.fid && !hoursRef.current[p.fid]);
    if (missing.length === 0) return;
    hoursFetchingRef.current = true;
    setHoursProgress({ done: 0, total: missing.length });
    try {
      const merged = await fetchHoursBatch(places, hoursRef.current, {
        onProgress: (p) => setHoursProgress(p),
      });
      hoursRef.current = merged;
      setHoursByFid({ ...merged });
    } finally {
      hoursFetchingRef.current = false;
      setHoursProgress(null);
    }
  }, []);

  // Time filters need hours: fetch them for the whole list in the
  // background (server-cached per place, so repeat visits are fast).
  useEffect(() => {
    if ((timeMode === 'now' || timeMode === 'at') && list) {
      void ensureHours(list.places);
    }
  }, [timeMode, list, ensureHours]);

  const selectPlace = useCallback(async (place: PlaceEntry) => {
    setSelected(place);
    if (place.fid && !hoursRef.current[place.fid]) {
      try {
        const h = await fetchHours(place);
        hoursRef.current = { ...hoursRef.current, [place.fid]: h };
        setHoursByFid({ ...hoursRef.current });
      } catch {
        // Hours stay unknown; the list still works.
      }
    }
  }, []);

  // ---- filtering ----

  const countries = useMemo(() => {
    if (!list) return [];
    const seen = new Map<string, number>();
    for (const p of list.places) {
      if (p.country) seen.set(p.country, (seen.get(p.country) ?? 0) + 1);
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]);
  }, [list]);

  const filtered = useMemo(() => {
    if (!list) return [];
    let out = list.places;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      out = out.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.address.toLowerCase().includes(q),
      );
    }
    if (country !== 'all') out = out.filter((p) => p.country === country);
    if (timeMode === 'now' || timeMode === 'at') {
      out = out.filter((p) => {
        if (!p.fid || !p.timezone) return false;
        const h = hoursByFid[p.fid];
        if (!h?.hours) return false;
        if (timeMode === 'now') {
          const { weekday, minutes } = partsInTz(p.timezone);
          return isOpenAt(h.hours, weekday, minutes);
        }
        const day =
          openAt.day === 'today'
            ? partsInTz(p.timezone).weekday
            : openAt.day;
        const [hh, mm] = openAt.time.split(':').map(Number);
        return isOpenAt(h.hours, day, hh * 60 + mm, openAt.duration * 60);
      });
    }
    if (sort === 'name') {
      out = [...out].sort((a, b) => a.name.localeCompare(b.name));
    }
    return out;
  }, [list, query, country, timeMode, openAt, sort, hoursByFid]);

  const hoursLoaded = useMemo(
    () => Object.keys(hoursByFid).length,
    [hoursByFid],
  );

  // Keep the ref current: map handlers created once on mount read the
  // latest filtered places through it (their closures would otherwise
  // see the empty initial list and push no data to the map).
  filteredRef.current = filtered;

  // ---- map ----

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: STYLES[0].url,
      center: SINGAPORE,
      zoom: 11,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    mapRef.current = map;
    // Debug affordance: lets a verification harness read camera state.
    (window as unknown as { __list2mapsMap?: maplibregl.Map }).__list2mapsMap =
      map;

    const addLayers = () => {
      if (map.getSource('places')) return;
      map.addSource('places', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterRadius: 50,
        clusterMaxZoom: 14,
      });
      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'places',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step',
            ['get', 'point_count'],
            '#0f766e',
            25,
            '#0d9488',
            100,
            '#f59e0b',
          ],
          'circle-radius': ['step', ['get', 'point_count'], 16, 25, 22, 100, 28],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'places',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-font': ['Noto Sans Bold'],
          'text-size': 12,
        },
        paint: { 'text-color': '#ffffff' },
      });
      map.addLayer({
        id: 'points',
        type: 'circle',
        source: 'places',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': '#0f766e',
          'circle-radius': 7,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
        },
      });
      map.addLayer({
        id: 'selected-point',
        type: 'circle',
        source: 'places',
        filter: [
          'all',
          ['!', ['has', 'point_count']],
          ['==', ['get', 'position'], -1],
        ],
        paint: {
          'circle-color': '#b45309',
          'circle-radius': 11,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
    };

    // Push the latest filtered places into the GeoJSON source. Used by
    // the map-load handlers and the [filtered] effect alike, so data
    // always flows whichever of style-load / list-load wins the race.
    const pushData = () => {
      const src = map.getSource('places') as
        | maplibregl.GeoJSONSource
        | undefined;
      if (!src) return;
      src.setData({
        type: 'FeatureCollection',
        features: filteredRef.current.filter(hasCoords).map(toFeature),
      });
    };

    map.on('load', () => {
      addLayers();
      pushData();
    });
    // setStyle() drops sources + layers; re-add them.
    map.on('style.load', () => {
      addLayers();
      pushData();
    });

    map.on('click', 'clusters', (e) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: ['clusters'],
      });
      const clusterId = features[0]?.properties?.cluster_id;
      if (clusterId === undefined) return;
      const source = map.getSource('places') as maplibregl.GeoJSONSource;
      const geom = features[0].geometry as {
        type: string;
        coordinates: [number, number];
      };
      source
        .getClusterExpansionZoom(clusterId)
        .then((zoom) => {
          map.easeTo({ center: geom.coordinates, zoom });
        })
        .catch(() => {
          // Cluster zoom unavailable; leave the view as is.
        });
    });
    map.on('click', 'points', (e) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: ['points'],
      });
      const position = features[0]?.properties?.position;
      if (position === undefined || !list) return;
      const place = list.places.find((p) => p.position === position);
      if (place) void selectPlace(place);
    });
    map.on('mouseenter', 'clusters', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'clusters', () => {
      map.getCanvas().style.cursor = '';
    });
    map.on('mouseenter', 'points', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'points', () => {
      map.getCanvas().style.cursor = '';
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push filtered places to the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource('places') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: 'FeatureCollection',
      features: filtered
        .filter(hasCoords)
        .map(toFeature),
    });
  }, [filtered]);

  // Highlight + fly to the selected place, with a popup.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.getLayer('selected-point')) {
      map.setFilter('selected-point', [
        'all',
        ['!', ['has', 'point_count']],
        ['==', ['get', 'position'], selected ? selected.position : -1],
      ]);
    }
    popupRef.current?.remove();
    popupRef.current = null;
    if (!selected || selected.lat === null || selected.lng === null) return;
    map.flyTo({
      center: [selected.lng, selected.lat],
      zoom: Math.max(map.getZoom(), 14),
      essential: true,
    });
    const popup = new maplibregl.Popup({ offset: 12, closeOnClick: false })
      .setLngLat([selected.lng, selected.lat])
      .setHTML(
        `<strong>${escapeHtml(selected.name)}</strong><br>${escapeHtml(selected.address)}`,
      )
      .addTo(map);
    popup.on('close', () => setSelected(null));
    popupRef.current = popup;
  }, [selected]);

  // Fit the map to the list on load.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !list) return;
    const pts = list.places.filter(hasCoords);
    if (pts.length === 0) return;
    const lngs = pts.map((p) => p.lng!);
    const lats = pts.map((p) => p.lat!);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 48, maxZoom: 15, duration: 800 },
    );
  }, [list]);

  const changeStyle = (id: string) => {
    const style = STYLES.find((s) => s.id === id);
    const map = mapRef.current;
    if (!style || !map) return;
    setStyleId(id);
    map.setStyle(style.url);
  };

  // ---- export ----

  const exportGeoJson = () => {
    const fc = {
      type: 'FeatureCollection',
      features: filtered
        .filter(hasCoords)
        .map((p) => {
          const h = p.fid ? hoursByFid[p.fid] : undefined;
          return {
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [p.lng, p.lat],
            },
            properties: {
              position: p.position,
              name: p.name,
              address: p.address,
              country: p.country,
              hours: h?.hours ? h.hours.text_by_day : null,
            },
          };
        }),
    };
    download(
      JSON.stringify(fc, null, 2),
      'application/geo+json',
      'list.geojson',
    );
  };

  const exportCsv = () => {
    const esc = (v: string | number | null) =>
      `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [
      ['position', 'name', 'address', 'country', 'lat', 'lng', 'hours'].join(','),
      ...filtered.map((p) => {
        const h = p.fid ? hoursByFid[p.fid] : undefined;
        const hoursText = h?.hours
          ? WEEKDAYS.map((d) => `${d.slice(0, 3)}: ${h.hours!.text_by_day[d] ?? ''}`).join(' | ')
          : '';
        return [
          p.position,
          esc(p.name),
          esc(p.address),
          p.country ?? '',
          p.lat ?? '',
          p.lng ?? '',
          esc(hoursText),
        ].join(',');
      }),
    ];
    download(rows.join('\n'), 'text/csv', 'list.csv');
  };

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      // Clipboard unavailable; the URL is already in the address bar.
    }
  };

  const selectedHours = selected?.fid ? hoursByFid[selected.fid] : undefined;
  const selectedStatus = selected
    ? openStatusNow(selectedHours?.hours ?? null, selected.timezone)
    : 'unknown';

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <img
            src="/logo.png"
            className="logo"
            alt="List2Maps logo"
            width={36}
            height={36}
          />
          <div className="brand-text">
            <h1>List2Maps</h1>
            <p>Turn any Google Maps shared list into a fast, filterable map.</p>
          </div>
        </div>
        <form
          className="loadbar"
          onSubmit={(e) => {
            e.preventDefault();
            void loadList(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste a Google Maps shared list link…"
            aria-label="Google Maps shared list link"
            spellCheck={false}
          />
          <button type="submit" disabled={loading || !input.trim()}>
            {loading ? 'Loading…' : 'Load list'}
          </button>
        </form>
        <div className="examples">
          Try:{' '}
          {examples.map((ex, i) => (
            <span key={ex.url}>
              {i > 0 ? ' · ' : ''}
              <button
                type="button"
                className="linklike"
                onClick={() => {
                  setInput(ex.url);
                  void loadList(ex.url);
                }}
              >
                {ex.label}
              </button>
            </span>
          ))}
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <main className="main">
        <aside className="sidebar">
          {list ? (
            <>
              <div className="listhead">
                <h2>{list.title ?? 'Shared list'}</h2>
                <p className="meta">
                  {list.count} places
                  {countries.length > 1
                    ? ` · ${countries.length} countries`
                    : ''}
                  {hoursLoaded > 0 ? ` · hours loaded for ${hoursLoaded}` : ''}
                  <br />
                  <span className="cache">
                    {cacheState?.cached
                      ? cacheState.stale
                        ? 'Served from cache (stale — refreshing in background)'
                        : `Served from cache · fetched ${new Date(cacheState.fetchedAt).toLocaleTimeString()}`
                      : 'Fetched live just now'}
                    {' · '}cached 4h
                  </span>
                </p>
              </div>

              <div className="filters">
                <input
                  className="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search name or address…"
                  aria-label="Search places"
                />
                <div className="filterrow">
                  {countries.length > 1 && (
                    <select
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      aria-label="Country"
                    >
                      <option value="all">All countries</option>
                      {countries.map(([code, n]) => (
                        <option key={code} value={code}>
                          {code} ({n})
                        </option>
                      ))}
                    </select>
                  )}
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as 'list' | 'name')}
                    aria-label="Sort"
                  >
                    <option value="list">List order</option>
                    <option value="name">Name A–Z</option>
                  </select>
                </div>
                <div className="timeseg" role="group" aria-label="Time filter">
                  <button
                    type="button"
                    className={timeMode === 'any' ? 'active' : ''}
                    onClick={() => setTimeMode('any')}
                  >
                    Any time
                  </button>
                  <button
                    type="button"
                    className={timeMode === 'now' ? 'active' : ''}
                    onClick={() => setTimeMode('now')}
                  >
                    Open now
                  </button>
                  <button
                    type="button"
                    className={timeMode === 'at' ? 'active' : ''}
                    onClick={() => setTimeMode('at')}
                  >
                    Open at…
                  </button>
                </div>
                {timeMode === 'at' && (
                  <div className="openat">
                    <select
                      value={openAt.day}
                      onChange={(e) =>
                        setOpenAt({ ...openAt, day: e.target.value })
                      }
                      aria-label="Day"
                    >
                      <option value="today">Today</option>
                      {WEEKDAYS.map((d) => (
                        <option key={d} value={d}>
                          {d.charAt(0).toUpperCase() + d.slice(1)}
                        </option>
                      ))}
                    </select>
                    <input
                      type="time"
                      value={openAt.time}
                      onChange={(e) =>
                        setOpenAt({ ...openAt, time: e.target.value })
                      }
                      aria-label="Time"
                    />
                    <select
                      value={openAt.duration}
                      onChange={(e) =>
                        setOpenAt({ ...openAt, duration: Number(e.target.value) })
                      }
                      aria-label="Duration in hours"
                    >
                      {[1, 2, 3, 4, 5, 6].map((h) => (
                        <option key={h} value={h}>
                          {h}h
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {hoursProgress && (
                  <div className="progress">
                    Fetching hours… {hoursProgress.done}/{hoursProgress.total}
                    <div className="bar">
                      <div
                        style={{
                          width: `${(hoursProgress.done / Math.max(1, hoursProgress.total)) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
                {(timeMode === 'now' || timeMode === 'at') && (
                  <p className="hint">
                    Open-now checks run in each place&apos;s own local time.
                    Places without listed hours are hidden by this filter.
                  </p>
                )}
              </div>

              {selected && (
                <div className="detail">
                  <button
                    type="button"
                    className="close"
                    onClick={() => setSelected(null)}
                    aria-label="Close details"
                  >
                    ×
                  </button>
                  <h3>{selected.name}</h3>
                  <p className="addr">{selected.address}</p>
                  <p className="status">
                    {selectedStatus === 'open' && (
                      <span className="open">● Open now</span>
                    )}
                    {selectedStatus === 'closed' && (
                      <span className="closed">● Closed now</span>
                    )}
                    {selectedStatus === 'unknown' &&
                      (selected.fid
                        ? 'Hours not listed'
                        : 'Custom pin — no Google place, so no hours')}
                  </p>
                  {selectedHours?.hours && (
                    <table className="hours">
                      <tbody>
                        {WEEKDAYS.map((d) => (
                          <tr key={d}>
                            <td>{d.charAt(0).toUpperCase() + d.slice(1, 3)}</td>
                            <td>{selectedHours.hours!.text_by_day[d] ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {selectedHours?.note && (
                    <p className="note">{selectedHours.note}</p>
                  )}
                  {selectedHours?.hours && (
                    <p className="note">
                      Week of {selectedHours.hours.week_start} –{' '}
                      {selectedHours.hours.week_end}
                    </p>
                  )}
                  <p className="links">
                    <a
                      href={googleMapsLink(selected, selectedHours?.placeId ?? null)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open in Google Maps ↗
                    </a>
                  </p>
                </div>
              )}

              <p className="count">
                Showing {filtered.length} of {list.count}
              </p>
              <ul className="places">
                {filtered.map((p) => {
                  const h = p.fid ? hoursByFid[p.fid] : undefined;
                  const status = openStatusNow(h?.hours ?? null, p.timezone);
                  return (
                    <li key={p.position}>
                      <button
                        type="button"
                        className={
                          selected?.position === p.position ? 'selected' : ''
                        }
                        onClick={() => void selectPlace(p)}
                      >
                        <span className="num">#{p.position}</span>
                        <span className="ptext">
                          <span className="pname">{p.name}</span>
                          <span className="paddr">{p.address}</span>
                        </span>
                        <span
                          className={`dot ${status}`}
                          title={
                            status === 'open'
                              ? 'Open now'
                              : status === 'closed'
                                ? 'Closed now'
                                : 'Hours unknown'
                          }
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
              {filtered.length === 0 && (
                <p className="empty">
                  Nothing matches these filters.
                  {timeMode !== 'any' && hoursProgress
                    ? ' Hours are still loading — matches will appear as they arrive.'
                    : ''}
                </p>
              )}
              <div className="exports">
                <button type="button" onClick={exportGeoJson}>
                  Export GeoJSON
                </button>
                <button type="button" onClick={exportCsv}>
                  Export CSV
                </button>
                <button type="button" onClick={copyShareLink}>
                  Copy share link
                </button>
              </div>
            </>
          ) : (
            <div className="intro">
              <h2>Paste a Google Maps list link</h2>
              <p>
                Paste a <code>maps.app.goo.gl</code> short link, a{' '}
                <code>google.com/maps</code> list URL, or a bare list id —
                every place shows up on the map, clustered and ready to
                browse.
              </p>
              <p>
                Search by name or address, filter by country, or find
                what&apos;s open now — or open at a time you pick, judged in
                each place&apos;s own local time. Export the filtered list as
                GeoJSON or CSV, and share it with a link.
              </p>
              <p>
                Lists and opening hours are fetched on the server and cached
                for 4 hours.
              </p>
            </div>
          )}
        </aside>

        <section className="mapwrap">
          <div ref={mapContainerRef} className="map" />
          <div className="style-switch" role="group" aria-label="Basemap style">
            {STYLES.map((s) => (
              <button
                key={s.id}
                type="button"
                className={styleId === s.id ? 'active' : ''}
                onClick={() => changeStyle(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function download(content: string, mime: string, filename: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
