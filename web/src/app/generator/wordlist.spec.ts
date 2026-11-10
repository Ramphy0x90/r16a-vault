import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The builder cannot serve files above the workspace root, so scripts/sync-shared.mjs copies
// the wordlist into public/. This catches a copy that drifted from the shared source.
describe('served wordlist', () => {
  it('is an exact copy of the shared wordlist', () => {
    const shared = readFileSync(
      resolve(process.cwd(), '../shared/wordlists/eff_large_wordlist.txt'),
      'utf8',
    );
    const served = readFileSync(
      resolve(process.cwd(), 'public/assets/eff_large_wordlist.txt'),
      'utf8',
    );
    expect(served).toBe(shared);
  });
});
