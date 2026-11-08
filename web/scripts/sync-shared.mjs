// Copies shared assets that live outside the Angular workspace into public/, because the
// builder refuses asset paths above the workspace root. The copy is tracked so a plain
// `ng serve` works, and the generator test fails if it drifts from the shared source.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'public', 'assets'), { recursive: true });
copyFileSync(join(root, '..', 'shared', 'wordlists', 'eff_large_wordlist.txt'), join(root, 'public', 'assets', 'eff_large_wordlist.txt'));
