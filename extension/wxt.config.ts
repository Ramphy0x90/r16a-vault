import { resolve } from 'node:path';

import { defineConfig } from 'wxt';

/**
 * Builds the Zaltys extension for Chromium browsers and Firefox from one source tree.
 *
 * Every permission here is justified in docs/EXTENSION_SPEC.md section 4, and
 * test/manifest.test.ts fails when the built manifest asks for anything else. There are no
 * declared content scripts and no standing host permissions, the server origin is requested at
 * runtime from the options page.
 */
export default defineConfig({
  srcDir: 'src',
  // Auto imports hide where code comes from, which matters when reviewing an extension.
  imports: false,
  manifestVersion: 3,
  manifest: ({ browser, mode }) => {
    const firefox = browser === 'firefox';
    return {
      name: 'Zaltys',
      description:
        'Zero-knowledge password vault. Unlock, fill and copy from your own Zaltys server.',
      permissions: [
        'storage',
        'activeTab',
        'scripting',
        'alarms',
        'idle',
        'contextMenus',
        'clipboardWrite',
        'identity',
        // Firefox has no offscreen documents, its event page clears the clipboard itself.
        ...(firefox ? [] : ['offscreen']),
      ],
      optional_host_permissions: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
      // Test builds only (`--mode e2e`). Automated tests cannot click the permission prompt, so
      // the end to end build is granted localhost up front. Release builds never carry this.
      ...(mode === 'e2e' ? { host_permissions: ['http://localhost/*'] } : {}),
      content_security_policy: {
        extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
      },
      action: {
        default_title: 'Zaltys',
        default_icon: { 16: 'icons/16.png', 32: 'icons/32.png' },
      },
      icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
      ...(firefox
        ? {
            browser_specific_settings: {
              gecko: {
                id: 'extension@zaltys.app',
                strict_min_version: '140.0',
                // Sign in proofs and encrypted vault data go to the server the user configures.
                data_collection_permissions: { required: ['authenticationInfo'] },
              },
              // Untested on Android, but the data collection key needs at least this version.
              gecko_android: { strict_min_version: '142.0' },
            },
          }
        : { minimum_chrome_version: '121' }),
    };
  },
  zip: {
    // Firefox reviewers rebuild from source, and the extension is built from the workspace, so
    // the sources zip starts at the repo root and takes only what the extension needs.
    sourcesRoot: resolve(__dirname, '..'),
    includeSources: [
      'package.json',
      'package-lock.json',
      '.prettierrc',
      'extension/**',
      'packages/**',
      'shared/wordlists/**',
    ],
    excludeSources: ['extension/.output/**', 'extension/.wxt/**', 'extension/test-results/**'],
  },
  hooks: {
    // Ships the wordlist straight from shared/, so there is no second copy to drift.
    'build:publicAssets': (_wxt, files) => {
      files.push({
        absoluteSrc: resolve(__dirname, '../shared/wordlists/eff_large_wordlist.txt'),
        relativeDest: 'eff_large_wordlist.txt',
      });
    },
  },
});
