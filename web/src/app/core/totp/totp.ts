import { HOTP, Secret, TOTP, URI } from 'otpauth';

/**
 * Client side TOTP per RFC 6238. The secret is decrypted only while a code is on screen,
 * so this module is pure and holds no state.
 */
export interface TotpConfig {
  readonly secret: Secret;
  readonly algorithm: 'SHA1' | 'SHA256' | 'SHA512';
  readonly digits: number;
  readonly period: number;
}

const BASE32 = /^[A-Z2-7]+$/;

/** Users paste secrets with spaces, hyphens, padding and lowercase, all of which carry no data. */
export function normaliseBase32(input: string): string {
  return input.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
}

/** Accepts a bare base32 secret or a full otpauth URI. Returns null when the input is unusable. */
export function parseTotp(input: string): TotpConfig | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    if (/^otpauth:\/\//i.test(trimmed)) {
      const parsed = URI.parse(trimmed);
      if (parsed instanceof HOTP || !(parsed instanceof TOTP)) return null;
      const algorithm = parsed.algorithm.toUpperCase();
      if (algorithm !== 'SHA1' && algorithm !== 'SHA256' && algorithm !== 'SHA512') return null;
      return { secret: parsed.secret, algorithm, digits: parsed.digits, period: parsed.period };
    }
    const b32 = normaliseBase32(trimmed);
    if (b32.length < 16 || !BASE32.test(b32)) return null;
    return { secret: Secret.fromBase32(b32), algorithm: 'SHA1', digits: 6, period: 30 };
  } catch {
    return null;
  }
}

export function totpCode(config: TotpConfig, timestampMs: number): string {
  return TOTP.generate({
    secret: config.secret,
    algorithm: config.algorithm,
    digits: config.digits,
    period: config.period,
    timestamp: timestampMs,
  });
}

export function secondsRemaining(config: TotpConfig, timestampMs: number): number {
  return config.period - (Math.floor(timestampMs / 1000) % config.period);
}

/** Splits a code into two halves for readability, `123456` becomes `123 456`. */
export function groupCode(code: string): string {
  const mid = Math.ceil(code.length / 2);
  return `${code.slice(0, mid)} ${code.slice(mid)}`;
}
