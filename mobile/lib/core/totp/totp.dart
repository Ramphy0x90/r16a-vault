import 'package:otp/otp.dart';

/// Client side TOTP per RFC 6238. Pure, the secret only exists while a code is on screen.
class TotpConfig {
  const TotpConfig(this.secret, this.algorithm, this.digits, this.period);

  final String secret;
  final Algorithm algorithm;
  final int digits;
  final int period;
}

final _base32 = RegExp(r'^[A-Z2-7]+$');

/// People paste secrets with spaces, hyphens, padding and lowercase, none of which carry data.
String normaliseBase32(String input) =>
    input.replaceAll(RegExp(r'[\s-]'), '').replaceAll(RegExp(r'=+$'), '').toUpperCase();

/// Accepts a bare base32 secret or an otpauth URI. Returns null for anything unusable.
TotpConfig? parseTotp(String input) {
  final trimmed = input.trim();
  if (trimmed.isEmpty) return null;
  if (trimmed.toLowerCase().startsWith('otpauth://')) {
    final uri = Uri.tryParse(trimmed);
    if (uri == null || uri.host.toLowerCase() != 'totp') return null;
    final q = uri.queryParameters;
    final secret = normaliseBase32(q['secret'] ?? '');
    final algorithm = switch ((q['algorithm'] ?? 'SHA1').toUpperCase()) {
      'SHA1' => Algorithm.SHA1,
      'SHA256' => Algorithm.SHA256,
      'SHA512' => Algorithm.SHA512,
      _ => null,
    };
    final digits = int.tryParse(q['digits'] ?? '6');
    final period = int.tryParse(q['period'] ?? '30');
    if (algorithm == null || digits == null || period == null) return null;
    if (digits < 6 || digits > 10 || period < 1 || period > 300) return null;
    if (secret.length < 16 || !_base32.hasMatch(secret)) return null;
    return TotpConfig(secret, algorithm, digits, period);
  }
  final secret = normaliseBase32(trimmed);
  if (secret.length < 16 || !_base32.hasMatch(secret)) return null;
  return TotpConfig(secret, Algorithm.SHA1, 6, 30);
}

/// `isGoogle` makes the otp package base32 decode the secret, as authenticator apps do.
/// Without it the package would treat the text itself as the key.
String totpCode(TotpConfig c, int timestampMs) => OTP.generateTOTPCodeString(
  _padded(c.secret),
  timestampMs,
  length: c.digits,
  interval: c.period,
  algorithm: c.algorithm,
  isGoogle: true,
);

int secondsRemaining(TotpConfig c, int timestampMs) => c.period - (timestampMs ~/ 1000) % c.period;

String groupCode(String code) {
  final mid = (code.length / 2).ceil();
  return '${code.substring(0, mid)} ${code.substring(mid)}';
}

/// The base32 decoder used by the otp package requires padding to a multiple of eight.
String _padded(String s) => s.padRight((s.length + 7) ~/ 8 * 8, '=');
