import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'ApplyFlow',
    description:
      'Fill job applications from a profile that stays on your machine: autofill, document attach, AI drafts, Notion tracking.',
    // Store listings order by version, so this is the number a release is cut
    // against. Keep it in step with package.json and the git tag.
    version: '1.0.0',
    permissions: ['storage', 'sidePanel'],
    // Every destination is pinned. There is no user-configurable endpoint, so
    // the extension cannot be pointed at an arbitrary host.
    host_permissions: [
      'https://api.notion.com/*',
      'https://openrouter.ai/*',
      'https://api.anthropic.com/*',
      'https://api.openai.com/*',
      'https://api.groq.com/*',
      'http://localhost:11434/*',
    ],
    // Chrome only grants an origin at runtime if it was declared here first,
    // so supporting a self-hosted endpoint needs a pattern. HTTPS only, and
    // deliberately not `http://*/*`: a custom endpoint carries an API key, and
    // there is no version of sending one in plaintext that is acceptable.
    // Nothing is granted until the user presses the button for their own host.
    optional_host_permissions: ['https://*/*'],
    action: {
      default_title: 'ApplyFlow',
    },
    /*
     * Pins the extension ID.
     *
     * Without this, an unpacked extension gets a new ID on every load, and
     * `externally_connectable` is keyed on that ID — so the dashboard would
     * lose its connection to the extension on every rebuild. The public half of
     * the key pair is safe to commit; the private half is in
     * applyflow-extension.pem, which is gitignored.
     */
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAlc+LvdEbZopZjVow1ELnZFOYeHLk81VIN+rNt51eNzckPDz4Rp8nSfQyx3iMaat5mlqJ6A+s0mtK1HWoWJHsgluyoPmfw+11TAiI8VTuFTXgRLuW/Uvr2QXWjj2nqxVHyjQ33uYk2WDKLWJACv70in+zxm73HJbsVsof9/3LNvQXCJnSfE+mz5GFUV8OCNcYe+pVIcKQ43jLW+4D+YoAHSksohZiDIzg7fojQw/B03Sa0dwX4LyHcmqRvlSN2qOOP4YLamxsPxtkkZ/doZSrFHIYf0CTvotEJ+OmG6hcW9BfyN4tkCr50i86BIpxtSYhqloZl4JJj/a10u8PwyJNqwIDAQAB',

    /*
     * Which pages may message this extension. Nothing else can, whatever it
     * sends. The list matches ALLOWED_ORIGINS in lib/dashboard-bridge.ts; both
     * exist so that a mistake in either one alone is not enough.
     */
    externally_connectable: {
      matches: ['https://applyflow-dashboard.vercel.app/*', 'http://localhost:5174/*'],
    },
  },
});
