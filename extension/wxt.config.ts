import { defineConfig } from 'wxt';
import { version } from './package.json' with { type: 'json' };

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: () => ({
    name: 'ApplyFlow',
    description:
      'Fill job applications from a profile that stays on your machine: autofill, document attach, AI drafts, and a dashboard of everything you have applied to.',
    /*
     * Read from package.json rather than written twice.
     *
     * The release workflow checks the git tag against package.json, so a
     * literal here was a second version nothing compared — a build could ship
     * a manifest that disagreed with the tag it was cut from and pass every
     * gate. There is now one number.
     */
    version,
    permissions: ['storage', 'sidePanel'],
    // The providers that ship with the extension. Each is pinned, so choosing
    // one of these grants nothing beyond it. A self-hosted endpoint is the one
    // exception and it is handled below, at runtime, one host at a time.
    host_permissions: [
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
     * Without this an unpacked extension gets a new ID on every load, and the
     * dashboard's own address — chrome-extension://<id>/dashboard/index.html —
     * would change with it, so every bookmark and open tab would go stale on
     * each rebuild. The public half of the key pair is safe to commit; the
     * private half is in applyflow-extension.pem, which is gitignored.
     */
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAlc+LvdEbZopZjVow1ELnZFOYeHLk81VIN+rNt51eNzckPDz4Rp8nSfQyx3iMaat5mlqJ6A+s0mtK1HWoWJHsgluyoPmfw+11TAiI8VTuFTXgRLuW/Uvr2QXWjj2nqxVHyjQ33uYk2WDKLWJACv70in+zxm73HJbsVsof9/3LNvQXCJnSfE+mz5GFUV8OCNcYe+pVIcKQ43jLW+4D+YoAHSksohZiDIzg7fojQw/B03Sa0dwX4LyHcmqRvlSN2qOOP4YLamxsPxtkkZ/doZSrFHIYf0CTvotEJ+OmG6hcW9BfyN4tkCr50i86BIpxtSYhqloZl4JJj/a10u8PwyJNqwIDAQAB',
  }),
});
