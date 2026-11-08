/**
 * Password and passphrase generation. Pure functions over an injectable random source so
 * the statistics can be tested, while production always uses the platform CSPRNG.
 */

export type RandomUint32 = () => number;

export const cryptoRandom: RandomUint32 = () => crypto.getRandomValues(new Uint32Array(1))[0];

const TWO_32 = 0x1_0000_0000;

/**
 * Uniform integer in [0, n) without modulo bias. Values from the top partial bucket of the
 * 32 bit range are rejected and redrawn, so every result is equally likely.
 */
export function uniformInt(n: number, rand: RandomUint32 = cryptoRandom): number {
  if (!Number.isInteger(n) || n <= 0 || n > TWO_32) throw new RangeError('n out of range');
  const limit = TWO_32 - (TWO_32 % n);
  for (;;) {
    const x = rand();
    if (x < limit) return x % n;
  }
}

export function shuffle<T>(items: T[], rand: RandomUint32 = cryptoRandom): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = uniformInt(i + 1, rand);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export const CHARSETS = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?/~',
} as const;
export type CharClass = keyof typeof CHARSETS;
export const AMBIGUOUS = 'Il1O0o|';

export interface RandomOptions {
  readonly length: number;
  readonly classes: readonly CharClass[];
  readonly excludeAmbiguous: boolean;
}

export const DEFAULT_RANDOM: RandomOptions = {
  length: 20,
  classes: ['upper', 'lower', 'digits', 'symbols'],
  excludeAmbiguous: true,
};
export const MIN_LENGTH = 8;
export const MAX_LENGTH = 128;

export function classAlphabets(opts: RandomOptions): string[] {
  return opts.classes.map((c) =>
    opts.excludeAmbiguous
      ? [...CHARSETS[c]].filter((ch) => !AMBIGUOUS.includes(ch)).join('')
      : CHARSETS[c],
  );
}

/**
 * One character is drawn from every selected class, the rest from the union, and the
 * result is shuffled. This guarantees each class appears without biasing positions.
 */
export function generatePassword(opts: RandomOptions, rand: RandomUint32 = cryptoRandom): string {
  const length = Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, Math.trunc(opts.length)));
  const alphabets = classAlphabets(opts);
  if (alphabets.length === 0) throw new RangeError('select at least one character class');
  const pool = alphabets.join('');
  const chars = alphabets.map((a) => a[uniformInt(a.length, rand)]);
  while (chars.length < length) chars.push(pool[uniformInt(pool.length, rand)]);
  return shuffle(chars, rand).join('');
}

/**
 * Entropy of a uniform choice among all strings of this length that contain every
 * selected class, by inclusion and exclusion. Each term is a ratio below one, so the sum
 * stays numerically stable even at 128 characters.
 */
export function passwordEntropy(opts: RandomOptions): number {
  const sizes = classAlphabets(opts).map((a) => a.length);
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  const length = Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, Math.trunc(opts.length)));
  let ratio = 0;
  for (let mask = 0; mask < 1 << sizes.length; mask++) {
    let excluded = 0;
    let bits = 0;
    sizes.forEach((s, i) => {
      if (mask & (1 << i)) {
        excluded += s;
        bits++;
      }
    });
    ratio += (bits % 2 ? -1 : 1) * ((total - excluded) / total) ** length;
  }
  return length * Math.log2(total) + Math.log2(Math.max(ratio, Number.MIN_VALUE));
}

export interface PassphraseOptions {
  readonly words: number;
  readonly separator: string;
  readonly capitalise: boolean;
  readonly includeNumber: boolean;
}

export const DEFAULT_PASSPHRASE: PassphraseOptions = {
  words: 6,
  separator: '-',
  capitalise: true,
  includeNumber: false,
};
export const MIN_WORDS = 3;
export const MAX_WORDS = 20;

export function generatePassphrase(
  wordlist: readonly string[],
  opts: PassphraseOptions,
  rand: RandomUint32 = cryptoRandom,
): string {
  const count = Math.min(MAX_WORDS, Math.max(MIN_WORDS, Math.trunc(opts.words)));
  const words = Array.from({ length: count }, () => {
    const w = wordlist[uniformInt(wordlist.length, rand)];
    return opts.capitalise ? w.charAt(0).toUpperCase() + w.slice(1) : w;
  });
  if (opts.includeNumber) {
    const at = uniformInt(count, rand);
    words[at] = `${words[at]}${uniformInt(10, rand)}`;
  }
  return words.join(opts.separator);
}

/** Capitalisation is deterministic so it adds nothing. A digit adds its value and its position. */
export function passphraseEntropy(wordlistSize: number, opts: PassphraseOptions): number {
  const count = Math.min(MAX_WORDS, Math.max(MIN_WORDS, Math.trunc(opts.words)));
  return count * Math.log2(wordlistSize) + (opts.includeNumber ? Math.log2(10 * count) : 0);
}

export type Strength = 'weak' | 'fair' | 'strong' | 'excellent';

export function strengthOf(bits: number): Strength {
  if (bits < 50) return 'weak';
  if (bits < 70) return 'fair';
  if (bits < 100) return 'strong';
  return 'excellent';
}
