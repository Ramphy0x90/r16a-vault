import { describe, expect, it } from 'vitest';

import { hostOf, normaliseUrl } from '../src/url';

describe('url normalisation', () => {
  it('adds https to bare hosts', () => {
    expect(normaliseUrl(' example.com/login ')).toBe('https://example.com/login');
  });
  it('keeps explicit http and https', () => {
    expect(normaliseUrl('http://intranet.local:8080')).toBe('http://intranet.local:8080/');
  });
  it('treats empty as no URL and rejects dangerous schemes', () => {
    expect(normaliseUrl('   ')).toBeNull();
    expect(normaliseUrl('javascript:alert(1)')).toBeUndefined();
    expect(normaliseUrl('data:text/html,x')).toBeUndefined();
  });
  it('extracts the host for display', () => {
    expect(hostOf('https://mail.example.com/inbox')).toBe('mail.example.com');
    expect(hostOf(null)).toBe('');
  });
});
