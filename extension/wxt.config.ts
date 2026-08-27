import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Job Application Autofiller',
    description: 'Fills job application forms from your locally-stored profile.',
    permissions: ['storage'],
    host_permissions: [
      'https://api.notion.com/*',
      'https://openrouter.ai/*',
      'http://localhost:11434/*',
    ],
    action: {
      default_title: 'Job Application Autofiller',
    },
  },
});
