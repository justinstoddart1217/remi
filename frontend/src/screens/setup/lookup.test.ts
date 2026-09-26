import { describe, expect, it } from 'vitest';

import { codeForCountry, countryForCode, isCurrentCountryCode } from './countries';
import { exactTimezone, matchTimezones, resolveTimezone, zoneCity, zoneOffset } from './timezones';

describe('countries', () => {
  it('names a code and finds the code for a name', () => {
    expect(countryForCode('DE')).toBe('Germany');
    expect(countryForCode('de')).toBeNull();
    expect(codeForCountry('germany')).toBe('DE');
    expect(codeForCountry('France')).toBe('FR');
    expect(codeForCountry('Great Britain')).toBe('GB');
    expect(codeForCountry('Atlantis')).toBeNull();
    expect(codeForCountry('')).toBeNull();
  });

  it('prefers current codes over deprecated aliases and groups', () => {
    expect(isCurrentCountryCode('DE')).toBe(true);
    expect(isCurrentCountryCode('DD')).toBe(false);
    expect(isCurrentCountryCode('UK')).toBe(false);
    expect(isCurrentCountryCode('EU')).toBe(false);
    expect(codeForCountry('Serbia')).toBe('RS');
  });
});

describe('time zones', () => {
  const zones = ['Africa/Johannesburg', 'America/Argentina/Buenos_Aires', 'Europe/London', 'Europe/Luxembourg', 'UTC'];

  it('matches the city first', () => {
    expect(matchTimezones('lon', zones)).toEqual(['Europe/London']);
    expect(matchTimezones('lu', zones)).toEqual(['Europe/Luxembourg']);
    expect(matchTimezones('europe', zones)).toEqual(['Europe/London', 'Europe/Luxembourg']);
    expect(matchTimezones('buenos aires', zones)).toEqual(['America/Argentina/Buenos_Aires']);
    expect(matchTimezones('  ', zones)).toEqual([]);
  });

  it('accepts only an exact zone', () => {
    expect(exactTimezone('europe/london', zones)).toBe('Europe/London');
    expect(exactTimezone('london', zones)).toBeNull();
  });

  it('settles a typed entry on its city, or on the only match, when the field is left', () => {
    expect(resolveTimezone('europe/london', zones)).toBe('Europe/London');
    expect(resolveTimezone('london', zones)).toBe('Europe/London');
    expect(resolveTimezone(' Buenos Aires ', zones)).toBe('America/Argentina/Buenos_Aires');
    expect(resolveTimezone('lond', zones)).toBe('Europe/London');
    expect(resolveTimezone('europe', zones)).toBeNull();
    expect(resolveTimezone('atlantis', zones)).toBeNull();
    expect(resolveTimezone('', zones)).toBeNull();
    // Two zones share a city name: nothing is guessed.
    expect(resolveTimezone('london', [...zones, 'America/London'])).toBeNull();
  });

  it('shows the city and the offset', () => {
    expect(zoneCity('America/Argentina/Buenos_Aires')).toBe('Buenos Aires');
    expect(zoneOffset('Europe/London', new Date('2026-10-05T09:00:00Z'))).toBe('GMT+1');
    expect(zoneOffset('Not/AZone')).toBe('');
  });
});
