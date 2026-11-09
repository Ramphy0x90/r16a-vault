/**
 * Turns a stored user agent into a short device name for the sessions list. Only a handful of
 * well known patterns are recognised, anything else falls back to a neutral label rather than
 * showing raw strings.
 */
export interface DeviceDescription {
  readonly name: string;
  readonly mobile: boolean;
}

const BROWSERS: readonly [RegExp, string][] = [
  [/Edg\//, 'Edge'],
  [/OPR\//, 'Opera'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const SYSTEMS: readonly [RegExp, string, boolean][] = [
  [/Android/, 'Android', true],
  [/iPhone|iPad|iPod/, 'iOS', true],
  [/Windows/, 'Windows', false],
  [/Mac OS X|Macintosh/, 'macOS', false],
  [/CrOS/, 'ChromeOS', false],
  [/Linux/, 'Linux', false],
];

export function describeUserAgent(ua: string | null): DeviceDescription {
  if (!ua) return { name: 'Unknown device', mobile: false };
  const app = /^r16a vault mobile \((\w+)\)/.exec(ua);
  if (app) return { name: `Zaltys app on ${app[1]}`, mobile: true };
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1];
  const system = SYSTEMS.find(([re]) => re.test(ua));
  if (!browser && !system) return { name: 'Unknown device', mobile: false };
  const name = [browser ?? 'Browser', system ? `on ${system[1]}` : ''].filter(Boolean).join(' ');
  return { name, mobile: system?.[2] ?? false };
}

const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

/** "just now", "5 minutes ago", "yesterday" and so on, in the browser's language. */
export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  if (Math.abs(seconds) < 60) return 'just now';
  const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const [unit, size] = UNITS.find(([, s]) => Math.abs(seconds) >= s) ?? UNITS[2];
  return fmt.format(Math.round(seconds / size), unit);
}
