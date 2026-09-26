/**
 * IANA time zones for the time-zone field, from the browser (`Intl.supportedValuesOf`), with
 * a short fallback list. Matching is by the city part first ('london' → Europe/London), then
 * anywhere in the name.
 */

const FALLBACK_ZONES: readonly string[] = [
  'Africa/Johannesburg',
  'America/New_York',
  'Asia/Hong_Kong',
  'Asia/Singapore',
  'Australia/Sydney',
  'Europe/Dublin',
  'Europe/Guernsey',
  'Europe/London',
  'Europe/Luxembourg',
  'UTC',
];

let zones: readonly string[] | undefined;

export function allTimezones(): readonly string[] {
  if (zones) return zones;
  let list: string[];
  try {
    list = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  } catch {
    list = [];
  }
  const merged = new Set([...list, ...FALLBACK_ZONES]);
  zones = [...merged].sort();
  return zones;
}

function norm(text: string): string {
  return text.trim().toLowerCase().replace(/[\s_]+/g, ' ');
}

/** Up to `limit` zones for a query, best first. An empty query gives nothing. */
export function matchTimezones(query: string, list: readonly string[] = allTimezones(), limit = 6): string[] {
  const q = norm(query);
  if (!q) return [];
  const scored: { zone: string; score: number }[] = [];
  for (const zone of list) {
    const z = norm(zone);
    const city = norm(zone.slice(zone.lastIndexOf('/') + 1));
    let score = -1;
    if (z === q || city === q) score = 0;
    else if (city.startsWith(q)) score = 1;
    else if (z.startsWith(q)) score = 2;
    else if (city.includes(q)) score = 3;
    else if (z.includes(q)) score = 4;
    if (score >= 0) scored.push({ zone, score });
  }
  scored.sort((a, b) => a.score - b.score || a.zone.localeCompare(b.zone));
  return scored.slice(0, limit).map((s) => s.zone);
}

/** The zone as typed, if it names a known zone exactly (case-insensitive), else null. */
export function exactTimezone(query: string, list: readonly string[] = allTimezones()): string | null {
  const q = norm(query);
  return list.find((z) => norm(z) === q) ?? null;
}

/**
 * The zone a typed entry settles on when the field is left without picking: the exact zone,
 * else the one zone whose city is the entry ('london' → Europe/London), else the only zone
 * that matches at all. null when the entry is ambiguous or matches nothing.
 */
export function resolveTimezone(query: string, list: readonly string[] = allTimezones()): string | null {
  const exact = exactTimezone(query, list);
  if (exact) return exact;
  const q = norm(query);
  if (!q) return null;
  const byCity = list.filter((z) => norm(z.slice(z.lastIndexOf('/') + 1)) === q);
  if (byCity.length === 1) return byCity[0] ?? null;
  const matches = matchTimezones(query, list, 2);
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

/** 'GMT+2', 'GMT+1' … for a zone right now; '' when the browser cannot say. */
export function zoneOffset(zone: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(at);
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

/** 'Europe/London' → 'London'; 'America/Argentina/Buenos_Aires' → 'Buenos Aires'. */
export function zoneCity(zone: string): string {
  return zone.slice(zone.lastIndexOf('/') + 1).replace(/_/g, ' ');
}
