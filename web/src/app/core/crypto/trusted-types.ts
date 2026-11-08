/**
 * Trusted Types default policy.
 *
 * The CSP enables `require-trusted-types-for 'script'`. Angular brings its own policies for
 * templates, so the only remaining sink is the Worker constructor used for Argon2. This
 * policy allows exactly same origin worker bundles and refuses everything else, which keeps
 * an injected string from ever becoming executable script.
 */
interface TrustedTypesLike {
  createPolicy(name: string, rules: { createScriptURL?: (input: string) => string }): unknown;
}

const WORKER_PATH = /^\/(?:[\w-]+\/)*worker-[\w-]+\.js$/;

export function installTrustedTypesPolicy(): void {
  const tt = (globalThis as { trustedTypes?: TrustedTypesLike }).trustedTypes;
  if (!tt) return;
  try {
    tt.createPolicy('default', {
      createScriptURL: (input: string) => {
        const url = new URL(input, location.href);
        if (url.origin === location.origin && WORKER_PATH.test(url.pathname)) return url.href;
        throw new TypeError('script URL blocked by policy');
      },
    });
  } catch {
    // A second registration attempt throws, which only happens in tests or hot reload.
  }
}
