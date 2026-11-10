import { defineConfig } from '@playwright/test';

// Extension tests drive the unpacked Chromium build. Firefox is tested by hand, see README.md.
export default defineConfig({
  testDir: 'test/e2e',
  timeout: 30_000,
  workers: 1,
  reporter: 'list',
});
