import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Must match the port in ALLOWED_ORIGINS and externally_connectable, or the
  // extension refuses to answer during development.
  server: { port: 5174 },
});
