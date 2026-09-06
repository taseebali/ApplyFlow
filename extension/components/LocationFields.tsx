import { COUNTRIES, isoForCountry, statesOf } from '@/lib/locations';
import { FieldLabel } from './fields';

/**
 * Country as a dropdown, state as whichever control the country warrants, city
 * as free text.
 *
 * The city list used to come from `country-state-city`, which weighed 8.7MB —
 * more than three quarters of the whole extension — and was downloaded by
 * every user, then parsed the moment this section opened. Application forms
 * take a city as free text anyway, and this is typed once during setup, so the
 * dataset was paying for nothing. The subdivision list went the same way: 197
 * countries and 96KB became the seven whose forms present a dropdown, and a
 * text input everywhere else (see `lib/locations.ts`).
 */
export function LocationFields({
  country,
  state,
  city,
  onChange,
}: {
  country: string;
  state: string;
  city: string;
  onChange: (patch: { country?: string; state?: string; city?: string }) => void;
}) {
  const iso = isoForCountry(country);
  const states = statesOf(iso);

  // A value saved before this list existed, or a place it does not name, must
  // stay selectable rather than being silently dropped.
  const withCurrent = (options: string[], current: string) =>
    current && !options.includes(current) ? [current, ...options] : options;

  return (
    <div className="grid">
      <label className="field">
        <FieldLabel label="Country" required />
        <select value={country} onChange={(e) => onChange({ country: e.target.value, state: '' })}>
          <option value="">Not set</option>
          {withCurrent(
            COUNTRIES.map((c) => c.name),
            country
          ).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <FieldLabel label="State / province" />
        {/* A dropdown only where one exists. Everywhere else this is a text
            input rather than a disabled select saying "None for this country",
            which left anyone outside the listed countries unable to enter a
            state at all — and is how the forms themselves ask for it. */}
        {states.length > 0 ? (
          <select value={state} onChange={(e) => onChange({ state: e.target.value })}>
            <option value="">Not set</option>
            {withCurrent(states, state).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : (
          <input type="text" value={state} onChange={(e) => onChange({ state: e.target.value })} />
        )}
      </label>

      <label className="field">
        <FieldLabel label="City" required />
        <input type="text" value={city} onChange={(e) => onChange({ city: e.target.value })} />
      </label>
    </div>
  );
}
