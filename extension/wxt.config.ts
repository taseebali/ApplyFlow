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
      'http://localhost:11434/*',
    ],
    action: {
      default_title: 'ApplyFlow',
    },
  },
});
