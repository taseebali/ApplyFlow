/**
 * Regenerates lib/locations.ts from `country-state-city`.
 *
 * That package is not a runtime dependency — it is 8.7MB, almost all city
 * names, and shipping it cost more than the whole rest of the extension. Only
 * countries and subdivisions are worth carrying, so they are generated once
 * and committed. Install the package temporarily to re-run this.
 */
import { writeFileSync } from 'node:fs';
import { Country, State } from 'country-state-city';

const countries = Country.getAllCountries().map((c) => ({ name: c.name, iso: c.isoCode }));
const states = {};
for (const country of countries) {
  const list = State.getStatesOfCountry(country.iso).map((s) => s.name);
  if (list.length) states[country.iso] = list;
}

const file = `/**
 * Countries and their first-level subdivisions, generated from
 * \`country-state-city\` and committed as data. Do not edit by hand.
 *
 * Regenerate with: npm i -D country-state-city && node scripts/generate-locations.mjs
 */

export interface CountryOption {
  name: string;
  iso: string;
}

export const COUNTRIES: CountryOption[] = ${JSON.stringify(countries)};

/** ISO country code to its first-level subdivisions. Absent when a country has none. */
export const STATES: Record<string, string[]> = ${JSON.stringify(states)};

export function statesOf(iso: string | undefined): string[] {
  return iso ? (STATES[iso] ?? []) : [];
}

export function isoForCountry(name: string): string | undefined {
  return COUNTRIES.find((c) => c.name === name)?.iso;
}
`;

writeFileSync(new URL('../lib/locations.ts', import.meta.url), file);
console.log(`Wrote ${countries.length} countries and ${Object.keys(states).length} state lists.`);
