/**
 * A convenience for working on the extension: a key in `.env.local` saves
 * re-pasting one into a freshly cleared profile on every dev reload.
 *
 * It is deliberately narrow. Vite inlines env vars at build time, so anything
 * read here without a `import.meta.env.DEV` guard would be compiled into the
 * published bundle and shipped to every user. The guard means a release build
 * substitutes `false` and the whole branch is dropped by the minifier — which
 * `scripts/check-no-secrets.mjs` verifies after every build.
 *
 * This is never a way to distribute a key. Users enter their own.
 */
export function devApiKey(): string {
  if (!import.meta.env.DEV) return '';
  return import.meta.env.WXT_OPENROUTER_KEY ?? '';
}
