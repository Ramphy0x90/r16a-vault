import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  AMBIGUOUS,
  CHARSETS,
  classAlphabets,
  DEFAULT_PASSPHRASE,
  DEFAULT_RANDOM,
  generatePassphrase,
  generatePassword,
  passphraseEntropy,
  passwordEntropy,
  shuffle,
  strengthOf,
  uniformInt,
} from './generator';

const WORDLIST_PATH = resolve(process.cwd(), '../shared/wordlists/eff_large_wordlist.txt');

describe('uniformInt', () => {
  it('rejects values from the partial top bucket instead of folding them', () => {
    const draws = [0xffff_ffff, 0xffff_fffe, 5];
    const rand = () => draws.shift() ?? 0;
    // With n = 3 the limit is 2^32 - 1, so the first value is rejected and the second kept.
    expect(uniformInt(3, rand)).toBe(0xffff_fffe % 3);
    expect(draws).toEqual([5]);
  });

  it('is roughly uniform', () => {
    const n = 7;
    const counts = new Array<number>(n).fill(0);
    const samples = 70_000;
    for (let i = 0; i < samples; i++) counts[uniformInt(n)]++;
    const expected = samples / n;
    const chi2 = counts.reduce((acc, c) => acc + (c - expected) ** 2 / expected, 0);
    // Critical value for 6 degrees of freedom at p = 0.001 is 22.46.
    expect(chi2).toBeLessThan(22.46);
  });

  it('shuffle keeps every element', () => {
    expect(shuffle([1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('generatePassword', () => {
  it('honours length bounds and always includes every selected class', () => {
    for (let i = 0; i < 500; i++) {
      const pw = generatePassword({ ...DEFAULT_RANDOM, length: 8 });
      expect(pw).toHaveLength(8);
      for (const cls of DEFAULT_RANDOM.classes) {
        expect([...pw].some((ch) => CHARSETS[cls].includes(ch))).toBe(true);
      }
    }
    expect(generatePassword({ ...DEFAULT_RANDOM, length: 500 })).toHaveLength(128);
    expect(generatePassword({ ...DEFAULT_RANDOM, length: 1 })).toHaveLength(8);
  });

  it('excludes ambiguous characters when asked', () => {
    const pw = generatePassword({ ...DEFAULT_RANDOM, length: 128 });
    expect([...pw].some((ch) => AMBIGUOUS.includes(ch))).toBe(false);
  });

  it('uses only selected classes', () => {
    const pw = generatePassword({ length: 64, classes: ['digits'], excludeAmbiguous: false });
    expect(pw).toMatch(/^[0-9]{64}$/);
  });

  it('spreads characters evenly across the pool', () => {
    const opts = { length: 128, classes: ['lower'] as const, excludeAmbiguous: false };
    const counts = new Map<string, number>();
    for (let i = 0; i < 200; i++)
      for (const ch of generatePassword(opts)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    const expected = (200 * 128) / 26;
    for (const c of counts.values()) expect(Math.abs(c - expected) / expected).toBeLessThan(0.15);
  });

  it('refuses an empty class selection', () => {
    expect(() => generatePassword({ length: 20, classes: [], excludeAmbiguous: false })).toThrow();
  });

  it('estimates entropy close to the naive bound', () => {
    const bits = passwordEntropy(DEFAULT_RANDOM);
    const pool = classAlphabets(DEFAULT_RANDOM).join('').length;
    expect(pool).toBe(81);
    expect(bits).toBeLessThan(20 * Math.log2(pool));
    expect(bits).toBeGreaterThan(20 * Math.log2(pool) - 2);
    expect(strengthOf(bits)).toBe('excellent');
  });
});

describe('wordlist and passphrases', () => {
  const text = readFileSync(WORDLIST_PATH, 'utf8');
  const words = text.trim().split('\n');

  it('serves an exact copy of the shared wordlist', () => {
    const served = readFileSync(
      resolve(process.cwd(), 'public/assets/eff_large_wordlist.txt'),
      'utf8',
    );
    expect(served).toBe(text);
  });

  it('ships the verified EFF large wordlist', () => {
    expect(createHash('sha256').update(text).digest('hex')).toBe(
      '6d557f0693958fb5e650b68b5bee585eb82cf4da32965505c789e924743bc522',
    );
    expect(words).toHaveLength(7776);
    expect(new Set(words).size).toBe(7776);
  });

  it('builds passphrases with the requested shape', () => {
    const p = generatePassphrase(words, {
      words: 5,
      separator: '.',
      capitalise: true,
      includeNumber: true,
    });
    const parts = p.split('.');
    expect(parts).toHaveLength(5);
    expect(parts.every((w) => /^[A-Z]/.test(w))).toBe(true);
    expect(parts.filter((w) => /\d$/.test(w))).toHaveLength(1);
  });

  it('reports passphrase entropy', () => {
    expect(passphraseEntropy(7776, DEFAULT_PASSPHRASE)).toBeCloseTo(6 * Math.log2(7776), 5);
    expect(strengthOf(passphraseEntropy(7776, { ...DEFAULT_PASSPHRASE, words: 3 }))).toBe('weak');
  });
});
