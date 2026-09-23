import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  /*
   * Relative asset URLs, because this build is served from two places: the dev
   * server at the root of localhost:5174, and — bundled into the extension —
   * from chrome-extension://<id>/dashboard/. An absolute "/assets/..." resolves
   * to the extension root there and 404s every script and stylesheet.
   */
  base: './',
  // Must match the port in ALLOWED_ORIGINS and externally_connectable, or the
  // extension refuses to answer during development.
  // strictPort because moving to 5175 on a taken port is not a fallback here:
  // the extension answers one origin, so the dashboard would load and be
  // refused, which looks like a broken dashboard rather than a busy port.
  server: { port: 5174, strictPort: true },
});
