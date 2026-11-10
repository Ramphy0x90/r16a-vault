import type sodiumModule from 'libsodium-wrappers-sumo';

export type Sodium = typeof sodiumModule;

let ready: Promise<Sodium> | null = null;

/**
 * Loads libsodium on first use, which keeps its half megabyte of WASM out of the initial
 * bundle, and resolves once the module is instantiated so callers never observe a half
 * initialised library.
 */
export function loadSodium(): Promise<Sodium> {
  ready ??= import('libsodium-wrappers-sumo').then(async (m) => {
    await m.default.ready;
    return m.default;
  });
  return ready;
}
