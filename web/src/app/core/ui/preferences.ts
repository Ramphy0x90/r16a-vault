/**
 * Device preferences in localStorage. Only non sensitive values belong here, and every
 * access tolerates storage being unavailable, as in private windows.
 */
export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preferences are a convenience, losing one is harmless.
  }
}
