/**
 * Country names for ISO 3166 two-letter codes, from the browser's own `Intl.DisplayNames`
 * (no data file, nothing fetched). Used to fill a rotation stop from either field.
 */

let names: Intl.DisplayNames | null | undefined;
let byName: Map<string, string> | undefined;

function displayNames(): Intl.DisplayNames | null {
  if (names !== undefined) return names;
  try {
    names = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en-GB'], { type: 'region' }) : null;
  } catch {
    names = null;
  }
  return names;
}

const A = 'A'.charCodeAt(0);

/** Two-letter region codes that are not countries. */
const NOT_COUNTRIES: ReadonlySet<string> = new Set(['EU', 'EZ', 'UN', 'QO', 'ZZ']);

/**
 * True for a current country code: not a group ('EU') and not a deprecated alias that the
 * locale data canonicalises to another code ('DD' → 'DE', 'UK' → 'GB', 'FX' → 'FR').
 */
export function isCurrentCountryCode(code: string): boolean {
  if (!/^[A-Z]{2}$/.test(code) || NOT_COUNTRIES.has(code)) return false;
  try {
    const canonical = Intl.getCanonicalLocales(`und-${code}`)[0];
    return canonical === undefined || canonical.toUpperCase() === `UND-${code}`;
  } catch {
    return false;
  }
}

/** 'DE' → 'Germany'; null for a code that is not a region. */
export function countryForCode(code: string): string | null {
  if (!/^[A-Z]{2}$/.test(code)) return null;
  const dn = displayNames();
  if (!dn) return null;
  try {
    const name = dn.of(code);
    return name && name !== code ? name : null;
  } catch {
    return null;
  }
}

function key(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]+/g, ' ')
    .trim();
}

/** Short names people type for the long official ones. */
const ALIASES: Readonly<Record<string, string>> = {
  uk: 'GB',
  britain: 'GB',
  'great britain': 'GB',
  england: 'GB',
  usa: 'US',
  us: 'US',
  america: 'US',
  holland: 'NL',
};

/** 'France' → 'FR' (case and accents ignored); null when the name is not recognised. */
export function codeForCountry(name: string): string | null {
  const k = key(name);
  if (!k) return null;
  const alias = ALIASES[k];
  if (alias) return alias;
  if (!byName) {
    byName = new Map();
    for (let i = 0; i < 26; i++) {
      for (let j = 0; j < 26; j++) {
        const code = String.fromCharCode(A + i, A + j);
        if (!isCurrentCountryCode(code)) continue;
        const country = countryForCode(code);
        if (country && !byName.has(key(country))) byName.set(key(country), code);
      }
    }
  }
  return byName.get(k) ?? null;
}
