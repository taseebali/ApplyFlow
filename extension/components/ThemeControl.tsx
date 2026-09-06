import { useEffect, useState } from 'react';
import { CircleHalfIcon, MoonIcon, SunIcon } from '@phosphor-icons/react';
import { getSettings, setSettings, type Theme } from '@/lib/settings';

/**
 * Light, dark, or follow the operating system.
 *
 * The panel had no control at all: it read `prefers-color-scheme` and that was
 * that. Following the OS is a reasonable default and a poor only option, since
 * a browser panel sits beside pages that do not follow it.
 *
 * The stamp goes on the document element, which is what the token blocks in
 * base.css key off. `system` deliberately stamps nothing, so only the media
 * query applies.
 */

const OPTIONS: Array<{ value: Theme; label: string; Icon: typeof SunIcon }> = [
  { value: 'light', label: 'Light', Icon: SunIcon },
  { value: 'dark', label: 'Dark', Icon: MoonIcon },
  { value: 'system', label: 'System', Icon: CircleHalfIcon },
];

export function applyTheme(theme: Theme): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

/** Applied once at startup, before anything renders, so there is no flash. */
export function useStoredTheme(): void {
  useEffect(() => {
    void getSettings().then((settings) => applyTheme(settings.theme));
  }, []);
}

export function ThemeControl() {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    void getSettings().then((settings) => setTheme(settings.theme));
  }, []);

  const choose = (next: Theme) => {
    setTheme(next);
    applyTheme(next);
    // Written through the whole settings object, like every other setting here,
    // so a concurrent save cannot drop it.
    void getSettings().then((settings) => setSettings({ ...settings, theme: next }));
  };

  return (
    <div className="theme-control" role="group" aria-label="Theme">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={theme === value}
          onClick={() => choose(value)}
        >
          <Icon size={17} weight="light" aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}
