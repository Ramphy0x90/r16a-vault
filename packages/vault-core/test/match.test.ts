import { describe, expect, it } from 'vitest';

import { matchSite, parseSite, sameSite } from '../src/match';

describe('parseSite', () => {
  it('assumes https when the scheme is missing', () => {
    expect(parseSite('example.com')?.origin).toBe('https://example.com');
  });

  it('refuses plain http outside loopback and every other scheme', () => {
    expect(parseSite('http://example.com')).toBeNull();
    expect(parseSite('ftp://example.com')).toBeNull();
    expect(parseSite('javascript:alert(1)')).toBeNull();
    expect(parseSite('http://localhost:3000')?.host).toBe('localhost');
  });

  it('lowercases hosts and converts IDNs to punycode', () => {
    expect(parseSite('https://LOGIN.Example.COM')?.host).toBe('login.example.com');
    expect(parseSite('https://bücher.de')?.registrableDomain).toBe('xn--bcher-kva.de');
  });

  it('has no registrable domain for IPs, loopback and bare public suffixes', () => {
    expect(parseSite('https://192.168.1.10')?.registrableDomain).toBeNull();
    expect(parseSite('http://127.0.0.1:8080')?.registrableDomain).toBeNull();
    expect(parseSite('https://co.uk')?.registrableDomain).toBeNull();
  });
});

describe('matchSite', () => {
  it('ranks the exact host above the same registrable domain', () => {
    expect(matchSite('https://login.example.com', 'https://login.example.com/a')).toBe('exact');
    expect(matchSite('https://login.example.com', 'https://www.example.com')).toBe('domain');
  });

  it('treats public suffix siblings as different sites', () => {
    expect(matchSite('https://bank.co.uk', 'https://evil.co.uk')).toBeNull();
    expect(matchSite('https://alice.github.io', 'https://bob.github.io')).toBeNull();
    expect(matchSite('https://a.alice.github.io', 'https://b.alice.github.io')).toBe('domain');
    expect(matchSite('https://shop.example.co.uk', 'https://www.example.co.uk')).toBe('domain');
  });

  it('never matches lookalike or suffix tricks', () => {
    expect(matchSite('https://example.com', 'https://example.com.evil.net')).toBeNull();
    expect(matchSite('https://example.com', 'https://notexample.com')).toBeNull();
  });

  it('honours exact host mode', () => {
    expect(matchSite('https://login.example.com', 'https://www.example.com', 'host')).toBeNull();
    expect(matchSite('https://login.example.com', 'https://login.example.com', 'host')).toBe(
      'exact',
    );
  });

  it('requires equal schemes and the stated port', () => {
    expect(matchSite('https://localhost:3000', 'http://localhost:3000')).toBeNull();
    expect(matchSite('https://example.com:8443', 'https://example.com')).toBeNull();
    expect(matchSite('https://example.com', 'https://example.com:8443')).toBe('exact');
  });

  it('matches IPs and loopback by exact host only', () => {
    expect(matchSite('https://10.0.0.1', 'https://10.0.0.1/login')).toBe('exact');
    expect(matchSite('http://localhost:3000', 'http://localhost:3000/x')).toBe('exact');
    expect(matchSite('https://10.0.0.1', 'https://10.0.0.2')).toBeNull();
  });

  it('returns nothing for missing or unusable URLs', () => {
    expect(matchSite(null, 'https://example.com')).toBeNull();
    expect(matchSite('https://example.com', 'chrome://settings')).toBeNull();
  });
});

describe('sameSite', () => {
  it('compares registrable domains, or hosts when there is none', () => {
    expect(sameSite('https://a.example.com/login', 'https://b.example.com/post')).toBe(true);
    expect(sameSite('https://example.com', 'https://example.net')).toBe(false);
    expect(sameSite('https://10.0.0.1', 'https://10.0.0.1:444')).toBe(true);
  });
});
