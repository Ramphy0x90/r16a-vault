import { describe, expect, it } from 'vitest';

import config from '../wxt.config';

/**
 * Guards the permission set. Adding a permission must be a deliberate change here and in
 * docs/EXTENSION_SPEC.md section 4, never a side effect of a dependency or a config edit.
 */
type ManifestFn = (env: {
  browser: string;
  manifestVersion: 3;
  mode: string;
  command: string;
}) => Record<string, unknown>;

const manifest = (browser: string, mode = 'production'): Record<string, unknown> =>
  (config.manifest as ManifestFn)({ browser, manifestVersion: 3, mode, command: 'build' });

const BASE = [
  'storage',
  'activeTab',
  'scripting',
  'alarms',
  'idle',
  'contextMenus',
  'clipboardWrite',
  'identity',
];

describe('manifest', () => {
  it('requests exactly the documented permissions', () => {
    expect(manifest('chrome')['permissions']).toEqual([...BASE, 'offscreen']);
    expect(manifest('firefox')['permissions']).toEqual(BASE);
  });

  it('has no standing host access, content scripts or external messaging', () => {
    for (const b of ['chrome', 'firefox']) {
      const m = manifest(b);
      expect(m['host_permissions']).toBeUndefined();
      expect(m['content_scripts']).toBeUndefined();
      expect(m['externally_connectable']).toBeUndefined();
      expect(m['web_accessible_resources']).toBeUndefined();
      expect(m['optional_host_permissions']).toEqual([
        'https://*/*',
        'http://localhost/*',
        'http://127.0.0.1/*',
      ]);
    }
  });

  it('grants localhost up front only in the end to end test build', () => {
    expect(manifest('chrome', 'development')['host_permissions']).toBeUndefined();
    expect(manifest('chrome', 'e2e')['host_permissions']).toEqual(['http://localhost/*']);
  });

  it('allows only WebAssembly beyond bundled scripts', () => {
    expect(manifest('chrome')['content_security_policy']).toEqual({
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    });
  });
});
