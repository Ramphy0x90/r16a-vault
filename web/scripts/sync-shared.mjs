// Copies shared assets that live outside the Angular workspace into public/, because the
// builder refuses asset paths above the workspace root. The copy is tracked so a plain
// `ng serve` works, and the generator test fails if it drifts from the shared source.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Packages may be installed in web/node_modules or hoisted to the workspace root, so look
// upwards the way Node itself resolves them.
function packageDir(name) {
  for (let dir = root; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) throw new Error(`${name} is not installed`);
  }
}
mkdirSync(join(root, 'public', 'assets'), { recursive: true });
copyFileSync(join(root, '..', 'shared', 'wordlists', 'eff_large_wordlist.txt'), join(root, 'public', 'assets', 'eff_large_wordlist.txt'));

// Licence texts that must accompany the bundled fonts, icons and wordlist. The copies are
// tracked and served from /licenses so the deployed app carries its notices.
const licenses = join(root, 'public', 'licenses');
mkdirSync(licenses, { recursive: true });
copyFileSync(join(packageDir('@fontsource-variable/inter'), 'LICENSE'), join(licenses, 'inter-OFL-1.1.txt'));
copyFileSync(join(packageDir('@fontsource-variable/jetbrains-mono'), 'LICENSE'), join(licenses, 'jetbrains-mono-OFL-1.1.txt'));
copyFileSync(join(packageDir('@tabler/icons'), 'LICENSE'), join(licenses, 'tabler-icons-MIT.txt'));
copyFileSync(join(root, '..', 'shared', 'wordlists', 'ATTRIBUTION.txt'), join(licenses, 'eff-wordlist-CC-BY-3.0.txt'));
