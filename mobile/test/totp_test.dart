import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:otp/otp.dart';
import 'package:r16a_vault/core/totp/totp.dart';

void main() {
  final vectors = jsonDecode(File('../shared/crypto-test-vectors.json').readAsStringSync()) as Map<String, dynamic>;
  const algorithms = {'SHA1': Algorithm.SHA1, 'SHA256': Algorithm.SHA256, 'SHA512': Algorithm.SHA512};

  for (final v in (vectors['totp'] as List).cast<Map<String, dynamic>>()) {
    test('matches ${v['name']}', () {
      final secret = v['secret'] as String;
      var config = parseTotp(secret);
      expect(config, isNotNull);
      if (!secret.startsWith('otpauth://')) {
        // RFC vectors carry parameters a bare secret cannot express.
        config = TotpConfig(config!.secret, algorithms[v['algorithm']]!, v['digits'] as int, v['period'] as int);
      }
      expect(config!.algorithm, algorithms[v['algorithm']]);
      expect(config.digits, v['digits']);
      expect(config.period, v['period']);
      expect(totpCode(config, (v['time'] as int) * 1000), v['code']);
    });
  }

  test('bare secrets default to SHA1, 6 digits, 30 seconds', () {
    final c = parseTotp('jbsw y3dp ehpk 3pxp')!;
    expect(c.algorithm, Algorithm.SHA1);
    expect(c.digits, 6);
    expect(c.period, 30);
  });

  test('rejects garbage and HOTP', () {
    expect(parseTotp(''), isNull);
    expect(parseTotp('ABCD'), isNull);
    expect(parseTotp('not base32 189'), isNull);
    expect(parseTotp('otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=1'), isNull);
  });

  test('countdown and grouping', () {
    final c = parseTotp('JBSWY3DPEHPK3PXP')!;
    expect(secondsRemaining(c, 59000), 1);
    expect(secondsRemaining(c, 60000), 30);
    expect(groupCode('123456'), '123 456');
  });
}
