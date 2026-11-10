/** Accepts what people type, such as `example.com`, and stores an absolute http or https URL. */
export function normaliseUrl(input: string): string | null | undefined {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    if (!url.hostname) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

export function hostOf(url: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}
