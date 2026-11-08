import 'dart:io';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:r16a_vault/features/generator/generator.dart';

void main() {
  test('uniformInt rejects the partial top bucket', () {
    final draws = [0xffffffff, 0xfffffffe, 5];
    expect(uniformInt(3, () => draws.removeAt(0)), 0xfffffffe % 3);
    expect(draws, [5]);
  });

  test('uniformInt is roughly uniform', () {
    const n = 7;
    final counts = List.filled(n, 0);
    const samples = 70000;
    for (var i = 0; i < samples; i++) {
      counts[uniformInt(n)]++;
    }
    const expected = samples / n;
    final chi2 = counts.fold<double>(0, (a, c) => a + pow(c - expected, 2) / expected);
    expect(chi2, lessThan(22.46));
  });

  test('passwords respect length and include every selected class', () {
    for (var i = 0; i < 300; i++) {
      final pw = generatePassword(const RandomOptions(length: 8));
      expect(pw.length, 8);
      for (final c in CharClass.values) {
        expect(pw.split('').any((ch) => charsets[c]!.contains(ch)), isTrue);
      }
      expect(pw.split('').any((ch) => ambiguous.contains(ch)), isFalse);
    }
    expect(generatePassword(const RandomOptions(length: 999)).length, 128);
    expect(
      generatePassword(const RandomOptions(length: 64, classes: {CharClass.digits}, excludeAmbiguous: false)),
      matches(RegExp(r'^[0-9]{64}$')),
    );
    expect(() => generatePassword(const RandomOptions(classes: {})), throwsArgumentError);
  });

  test('entropy matches the web implementation', () {
    final bits = passwordEntropy(const RandomOptions());
    expect(classAlphabets(const RandomOptions()).join().length, 81);
    expect(bits, lessThan(20 * log(81) / ln2));
    expect(bits, greaterThan(20 * log(81) / ln2 - 2));
    expect(strengthOf(bits), Strength.excellent);
  });

  test('bundled wordlist matches the shared copy and checksum', () {
    final bundled = File('assets/eff_large_wordlist.txt').readAsBytesSync();
    final shared = File('../shared/wordlists/eff_large_wordlist.txt').readAsBytesSync();
    expect(sha256.convert(bundled).toString(), '6d557f0693958fb5e650b68b5bee585eb82cf4da32965505c789e924743bc522');
    expect(bundled, shared);
  });

  test('passphrases have the requested shape', () {
    final words = File('assets/eff_large_wordlist.txt').readAsStringSync().trim().split('\n');
    expect(words.length, 7776);
    final p = generatePassphrase(words, const PassphraseOptions(words: 5, separator: '.', includeNumber: true));
    final parts = p.split('.');
    expect(parts.length, 5);
    expect(parts.where((w) => RegExp(r'\d$').hasMatch(w)).length, 1);
    expect(passphraseEntropy(7776, const PassphraseOptions()), closeTo(6 * log(7776) / ln2, 1e-9));
  });
}
