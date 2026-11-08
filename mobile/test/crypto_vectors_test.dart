import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:r16a_vault/core/crypto/protocol.dart';
import 'package:sodium/sodium_sumo.dart';

String hex(Uint8List b) => b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();
Uint8List unhex(String h) =>
    Uint8List.fromList([for (var i = 0; i < h.length; i += 2) int.parse(h.substring(i, i + 2), radix: 16)]);

void main() {
  late SodiumSumo sodium;
  final vectors = jsonDecode(File('../shared/crypto-test-vectors.json').readAsStringSync()) as Map<String, dynamic>;

  setUpAll(() async {
    sodium = await SodiumSumoInit.init();
  });

  String keyHex(SecureKey k) => hex(k.extractBytes());

  group('argon2id', () {
    for (final c in (vectors['argon2id'] as List).cast<Map<String, dynamic>>()) {
      test('derives master key and subkeys for ${c['name']}', () {
        final pw = passwordBytes(c['password'] as String);
        expect(hex(pw), c['passwordNfcUtf8Hex']);
        final master = stretch(
          sodium,
          pw,
          unhex(c['saltHex'] as String),
          KdfParams(opslimit: c['opslimit'] as int, memlimit: c['memlimit'] as int),
        );
        expect(keyHex(master), c['masterKeyHex']);
        final keys = splitMasterKey(sodium, master);
        expect(keyHex(keys.authKey), c['authKeyHex']);
        expect(keyHex(keys.wrapKey), c['wrapKeyHex']);
        keys.dispose();
      });
    }

    test('composed and decomposed passwords agree', () {
      final cases = (vectors['argon2id'] as List).cast<Map<String, dynamic>>();
      final composed = cases.firstWhere((c) => c['name'] == 'non-ascii-composed');
      final decomposed = cases.firstWhere((c) => c['name'] == 'non-ascii-decomposed');
      expect(composed['password'], isNot(decomposed['password']));
      expect(hex(passwordBytes(decomposed['password'] as String)), composed['passwordNfcUtf8Hex']);
      expect(composed['masterKeyHex'], decomposed['masterKeyHex']);
    });
  });

  test('derives subkeys from a fixed master key', () {
    final k = vectors['kdf'] as Map<String, dynamic>;
    final keys = splitMasterKey(sodium, SecureKey.fromList(sodium, unhex(k['masterKeyHex'] as String)));
    expect(keyHex(keys.authKey), k['authKeyHex']);
    expect(keyHex(keys.wrapKey), k['wrapKeyHex']);
  });

  test('wraps and unwraps the vault key', () {
    final w = vectors['wrap'] as Map<String, dynamic>;
    final wrapKey = SecureKey.fromList(sodium, unhex(w['wrapKeyHex'] as String));
    final blob = sealWithNonce(
      sodium,
      wrapKey,
      unhex(w['vaultKeyHex'] as String),
      w['aad'] as String,
      unhex(w['nonceHex'] as String),
    );
    expect(hex(blob), w['blobHex']);
    expect(keyHex(unwrapVaultKey(sodium, wrapKey, blob)), w['vaultKeyHex']);
  });

  for (final field in ['meta', 'secret']) {
    test('seals and opens the credential $field blob', () {
      final c = vectors['credential'] as Map<String, dynamic>;
      final f = c[field] as Map<String, dynamic>;
      expect(credentialAad(c['credentialId'] as String, field), f['aad']);
      final key = SecureKey.fromList(sodium, unhex(c['vaultKeyHex'] as String));
      final blob = sealWithNonce(
        sodium,
        key,
        Uint8List.fromList(utf8.encode(f['plaintext'] as String)),
        f['aad'] as String,
        unhex(f['nonceHex'] as String),
      );
      expect(hex(blob), f['blobHex']);
      expect(utf8.decode(open(sodium, key, blob, f['aad'] as String)), f['plaintext']);
    });
  }

  final negative = vectors['negative'] as Map<String, dynamic>;
  for (final n in (negative['cases'] as List).cast<Map<String, dynamic>>()) {
    test('rejects ${n['name']}', () {
      final key = SecureKey.fromList(sodium, unhex(negative['vaultKeyHex'] as String));
      expect(() => open(sodium, key, unhex(n['blobHex'] as String), n['aad'] as String), throwsA(isA<CryptoError>()));
    });
  }

  test('refuses KDF parameters outside the floor and ceiling', () {
    expect(const KdfParams(opslimit: 2, memlimit: 64 << 20).acceptable, isFalse);
    expect(const KdfParams(opslimit: 3, memlimit: 1024).acceptable, isFalse);
    expect(const KdfParams(opslimit: 11, memlimit: 64 << 20).acceptable, isFalse);
    expect(KdfParams.defaults.acceptable, isTrue);
  });
}
