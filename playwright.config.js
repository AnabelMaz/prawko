const { defineConfig } = require('@playwright/test');

// Local machine: hit the existing Prawko service (localhost:5173).
// CI has no service, so it serves src/ on 3333 for the test job only.
const useCiStaticServer = Boolean(process.env.CI) && !process.env.PRAWKO_BASE_URL;

module.exports = defineConfig({
  testDir: './tests',
  use: {
    baseURL: process.env.PRAWKO_BASE_URL || (useCiStaticServer ? 'http://localhost:3333' : 'http://localhost:5173'),
    locale: 'pl-PL',
    screenshot: 'on',
    serviceWorkers: 'block',
  },
  webServer: useCiStaticServer
    ? {
        command: 'npx --yes http-server src -p 3333 -c-1 --silent',
        port: 3333,
        reuseExistingServer: true,
        timeout: 180000,
      }
    : undefined,
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium', viewport: { width: 420, height: 900 } },
    },
  ],
});
