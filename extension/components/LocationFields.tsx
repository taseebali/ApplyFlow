import { COUNTRIES, isoForCountry, statesOf } from '@/lib/locations';
import { FieldLabel } from './ProfileForm';

/**
 * Country and state as dropdowns; city as free text.
 *
 * The city list used to come from `country-state-city`, which weighed 8.7MB —
 * more than three quarters of the whole extension — and was downloaded by
 * every user, then parsed the moment this section opened. Application forms
 * take a city as free text anyway, and this is typed once during setup, so the
 * dataset was paying for nothing. Countries and subdivisions are small enough
 * to carry as generated data (see `lib/locations.ts`).
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
        <select
          value={state}
          disabled={!iso || states.length === 0}
          onChange={(e) => onChange({ state: e.target.value })}
        >
          <option value="">{states.length ? 'Not set' : 'None for this country'}</option>
          {withCurrent(states, state).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <FieldLabel label="City" required />
        <input type="text" value={city} onChange={(e) => onChange({ city: e.target.value })} />
      </label>
    </div>
  );
}
