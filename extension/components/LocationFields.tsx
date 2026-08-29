import { useEffect, useState } from 'react';

interface Option {
  name: string;
  isoCode: string;
}

/**
 * Country, state and city as dropdowns, each narrowing the next. The dataset
 * is several megabytes, so it is imported only when this section is actually
 * shown rather than shipped in the panel's main chunk.
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
  const [countries, setCountries] = useState<Option[]>([]);
  const [states, setStates] = useState<Option[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import('country-state-city')
      .then(({ Country }) => {
        if (cancelled) return;
        setCountries(Country.getAllCountries().map((c) => ({ name: c.name, isoCode: c.isoCode })));
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const countryCode = countries.find((c) => c.name === country)?.isoCode;

  useEffect(() => {
    if (!countryCode) {
      setStates([]);
      return;
    }
    let cancelled = false;
    void import('country-state-city').then(({ State }) => {
      if (cancelled) return;
      setStates(State.getStatesOfCountry(countryCode).map((s) => ({ name: s.name, isoCode: s.isoCode })));
    });
    return () => {
      cancelled = true;
    };
  }, [countryCode]);

  const stateCode = states.find((s) => s.name === state)?.isoCode;

  useEffect(() => {
    if (!countryCode) {
      setCities([]);
      return;
    }
    let cancelled = false;
    void import('country-state-city').then(({ City }) => {
      if (cancelled) return;
      // Some countries have no states at all, so fall back to every city in
      // the country rather than showing an empty list.
      const list = stateCode
        ? City.getCitiesOfState(countryCode, stateCode)
        : City.getCitiesOfCountry(countryCode) ?? [];
      setCities(list.map((c) => c.name));
    });
    return () => {
      cancelled = true;
    };
  }, [countryCode, stateCode]);

  // A saved value from before this dataset existed, or a place it does not
  // list, must stay selectable rather than being silently dropped.
  const withCurrent = (options: string[], current: string) =>
    current && !options.includes(current) ? [current, ...options] : options;

  if (failed) {
    return (
      <p className="hint">
        Could not load the location list. Type your country, state and city into the fields above instead.
      </p>
    );
  }

  return (
    <div className="grid">
      <label className="field">
        <span>Country</span>
        <select
          value={country}
          onChange={(e) => onChange({ country: e.target.value, state: '', city: '' })}
        >
          <option value="">Not set</option>
          {withCurrent(
            countries.map((c) => c.name),
            country
          ).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>State / province</span>
        <select
          value={state}
          disabled={!countryCode || states.length === 0}
          onChange={(e) => onChange({ state: e.target.value, city: '' })}
        >
          <option value="">{states.length ? 'Not set' : 'None for this country'}</option>
          {withCurrent(
            states.map((s) => s.name),
            state
          ).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>City</span>
        <select value={city} disabled={!countryCode} onChange={(e) => onChange({ city: e.target.value })}>
          <option value="">Not set</option>
          {withCurrent(cities, city).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
