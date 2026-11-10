/// <reference lib="webworker" />
/**
 * Runs Argon2id off the main thread so the UI stays responsive during the roughly one
 * second of stretching. Inputs are wiped before replying, and the master key buffer is
 * transferred rather than copied so no second copy stays behind in this worker.
 */
import { loadSodium, stretch, type KdfParams } from '@zaltys/vault-core';

interface Request {
  readonly id: number;
  readonly password: Uint8Array;
  readonly salt: Uint8Array;
  readonly kdf: KdfParams;
}

addEventListener('message', async ({ data }: MessageEvent<Request>) => {
  const sodium = await loadSodium();
  try {
    const derived = stretch(sodium, data.password, data.salt, data.kdf);
    // The library result may share memory with the WASM heap, so it is copied into a
    // standalone buffer that can be transferred, then the original is wiped.
    const key = new Uint8Array(derived);
    sodium.memzero(derived);
    postMessage({ id: data.id, key }, [key.buffer]);
  } catch {
    postMessage({ id: data.id, error: true });
  } finally {
    sodium.memzero(data.password);
  }
});
