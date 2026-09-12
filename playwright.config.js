const { defineConfig } = require('@playwright/test');

// Default: serve src/ on 3333 (same as CI). Parallel workers stay isolated from ProgramData :5173.
// PRAWKO_BASE_URL=http://localhost:5173 — test against a live install instead.
const useStaticServer = !process.env.PRAWKO_BASE_URL;

module.exports = defineConfig({
  testDir: './tests',
  retries: 2,
  workers: process.env.CI ? undefined : 1,
  use: {
    baseURL: process.env.PRAWKO_BASE_URL || 'http://localhost:3333',
    locale: 'pl-PL',
    screenshot: 'on',
    serviceWorkers: 'block',
  },
  webServer: useStaticServer
    ? {
        command: 'npx http-server src -p 3333 -c-1 --silent',
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
