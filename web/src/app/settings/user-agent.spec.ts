import { describeUserAgent, relativeTime } from './user-agent';

describe('describeUserAgent', () => {
  it('names common browsers and systems', () => {
    expect(
      describeUserAgent(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
      ),
    ).toEqual({ name: 'Chrome on Linux', mobile: false });
    expect(
      describeUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit Safari/604.1',
      ).name,
    ).toBe('Safari on iOS');
    expect(
      describeUserAgent('Mozilla/5.0 (Windows NT 10.0; rv:140.0) Gecko/20100101 Firefox/140.0')
        .name,
    ).toBe('Firefox on Windows');
  });

  it('recognises the mobile app and falls back for anything else', () => {
    expect(describeUserAgent('r16a vault mobile (Android)')).toEqual({
      name: 'r16a vault app on Android',
      mobile: true,
    });
    expect(describeUserAgent(null).name).toBe('Unknown device');
    expect(describeUserAgent('curl/8.0').name).toBe('Unknown device');
  });
});

describe('relativeTime', () => {
  it('rounds to the largest sensible unit', () => {
    const now = Date.parse('2026-11-08T12:00:00Z');
    expect(relativeTime('2026-11-08T11:59:40Z', now)).toBe('just now');
    expect(relativeTime('2026-11-08T11:55:00Z', now)).toMatch(/5 minutes ago/);
    expect(relativeTime('2026-11-08T09:00:00Z', now)).toMatch(/3 hours ago/);
  });
});
