import vectors from '../../../../../shared/crypto-test-vectors.json';

import {
  canonicalTotpSecret,
  groupCode,
  normaliseBase32,
  parseTotp,
  secondsRemaining,
  totpCode,
} from './totp';

describe('totp', () => {
  for (const v of vectors.totp) {
    it(`matches ${v.name}`, () => {
      const parsed = v.secret.startsWith('otpauth://')
        ? parseTotp(v.secret)
        : // RFC vectors carry non default parameters that a bare secret cannot express.
          (() => {
            const base = parseTotp(v.secret);
            return (
              base && {
                ...base,
                algorithm: v.algorithm as 'SHA1',
                digits: v.digits,
                period: v.period,
              }
            );
          })();
      expect(parsed).not.toBeNull();
      if (!parsed) return;
      expect(parsed.algorithm).toBe(v.algorithm);
      expect(parsed.digits).toBe(v.digits);
      expect(parsed.period).toBe(v.period);
      expect(totpCode(parsed, v.time * 1000)).toBe(v.code);
    });
  }

  it('defaults to SHA1, 6 digits and 30 seconds for bare secrets', () => {
    const c = parseTotp('jbsw y3dp ehpk 3pxp');
    expect(c).toMatchObject({ algorithm: 'SHA1', digits: 6, period: 30 });
  });

  it('normalises spacing, case, hyphens and padding', () => {
    expect(normaliseBase32(' jbsw-y3dp ehpk3pxp== ')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('rejects garbage, short secrets and HOTP URIs', () => {
    expect(parseTotp('')).toBeNull();
    expect(parseTotp('not base32 at all 1890')).toBeNull();
    expect(parseTotp('ABCD')).toBeNull();
    expect(parseTotp('otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=1')).toBeNull();
  });

  it('computes the countdown and groups codes', () => {
    const c = parseTotp('JBSWY3DPEHPK3PXP');
    expect(c && secondsRemaining(c, 59_000)).toBe(1);
    expect(c && secondsRemaining(c, 60_000)).toBe(30);
    expect(groupCode('123456')).toBe('123 456');
    expect(groupCode('12345678')).toBe('1234 5678');
  });

  it('applies the same otpauth bounds as the mobile client', () => {
    const base = 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP';
    expect(parseTotp(base)).not.toBeNull();
    expect(parseTotp(`${base}&digits=5`)).toBeNull();
    expect(parseTotp(`${base}&digits=11`)).toBeNull();
    expect(parseTotp(`${base}&period=301`)).toBeNull();
    expect(parseTotp('otpauth://totp/x?secret=JBSWY3DP')).toBeNull();
  });

  it('stores bare secrets normalised and otpauth links whole', () => {
    expect(canonicalTotpSecret(' jbsw y3dp-ehpk 3pxp== ')).toBe('JBSWY3DPEHPK3PXP');
    const uri = 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=8';
    expect(canonicalTotpSecret(` ${uri} `)).toBe(uri);
  });
});
