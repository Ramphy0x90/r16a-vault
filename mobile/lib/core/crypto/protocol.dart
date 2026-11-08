/// The r16a-vault client crypto protocol on top of libsodium.
///
/// This mirrors web/src/app/core/crypto/protocol.ts step for step and is tested byte for
/// byte against shared/crypto-test-vectors.json. Any change here must be made on both
/// clients and the vectors regenerated, otherwise the clients stop interoperating.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:sodium/sodium_sumo.dart';
import 'package:unorm_dart/unorm_dart.dart' as unorm;

const blobVersion = 0x01;
const nonceBytes = 24;
const keyBytes = 32;
const saltBytes = 16;
const _minBlob = 1 + nonceBytes + 16;
const vaultKeyAad = 'r16a-vault:vk:v1';

String credentialAad(String id, String field) => 'r16a-vault:cred:v1:${id.toLowerCase()}:$field';

class KdfParams {
  const KdfParams({required this.opslimit, required this.memlimit, this.alg = 'argon2id13'});

  factory KdfParams.fromJson(Map<String, dynamic> json) =>
      KdfParams(alg: json['alg'] as String, opslimit: json['opslimit'] as int, memlimit: json['memlimit'] as int);

  final String alg;
  final int opslimit;
  final int memlimit;

  static const defaults = KdfParams(opslimit: 3, memlimit: 64 * 1024 * 1024);

  Map<String, dynamic> toJson() => {'alg': alg, 'opslimit': opslimit, 'memlimit': memlimit};

  /// A hostile server could hand out weak parameters to downgrade key stretching, or huge
  /// ones to exhaust the device. Both are refused before any derivation starts.
  bool get acceptable =>
      alg == 'argon2id13' &&
      opslimit >= 3 &&
      opslimit <= 10 &&
      memlimit >= 64 * 1024 * 1024 &&
      memlimit <= 1024 * 1024 * 1024;
}

enum CryptoErrorCode { kdfRejected, decryptFailed, badEnvelope }

class CryptoError implements Exception {
  const CryptoError(this.code);
  final CryptoErrorCode code;

  @override
  String toString() => 'CryptoError(${code.name})';
}

/// NFC keeps passwords typed on different platforms byte identical. No trimming or case folding.
Uint8List passwordBytes(String password) => Uint8List.fromList(utf8.encode(unorm.nfc(password)));

/// Overwrites a plain buffer. Dart strings cannot be wiped, but byte buffers we own can.
void wipe(Uint8List bytes) => bytes.fillRange(0, bytes.length, 0);

SecureKey stretch(SodiumSumo sodium, Uint8List password, Uint8List salt, KdfParams kdf) {
  return sodium.crypto.pwhash(
    outLen: keyBytes,
    password: password.buffer.asInt8List(password.offsetInBytes, password.length),
    salt: salt,
    opsLimit: kdf.opslimit,
    memLimit: kdf.memlimit,
    alg: CryptoPwhashAlgorithm.argon2id13,
  );
}

class Subkeys {
  Subkeys(this.authKey, this.wrapKey);
  final SecureKey authKey;
  final SecureKey wrapKey;

  void dispose() {
    authKey.dispose();
    wrapKey.dispose();
  }
}

/// Derives both subkeys and disposes the master key, which must not outlive this call.
Subkeys splitMasterKey(Sodium sodium, SecureKey masterKey) {
  try {
    return Subkeys(
      sodium.crypto.kdf.deriveFromKey(
        masterKey: masterKey,
        context: 'r16aauth',
        subkeyId: BigInt.one,
        subkeyLen: keyBytes,
      ),
      sodium.crypto.kdf.deriveFromKey(
        masterKey: masterKey,
        context: 'r16awrap',
        subkeyId: BigInt.two,
        subkeyLen: keyBytes,
      ),
    );
  } finally {
    masterKey.dispose();
  }
}

Uint8List sealWithNonce(Sodium sodium, SecureKey key, Uint8List plaintext, String aad, Uint8List nonce) {
  final ct = sodium.crypto.aeadXChaCha20Poly1305IETF.encrypt(
    message: plaintext,
    nonce: nonce,
    key: key,
    additionalData: Uint8List.fromList(utf8.encode(aad)),
  );
  final out = Uint8List(1 + nonceBytes + ct.length);
  out[0] = blobVersion;
  out.setRange(1, 1 + nonceBytes, nonce);
  out.setRange(1 + nonceBytes, out.length, ct);
  return out;
}

/// A fresh random nonce per call is safe because XChaCha20 nonces are 192 bits.
Uint8List seal(Sodium sodium, SecureKey key, Uint8List plaintext, String aad) =>
    sealWithNonce(sodium, key, plaintext, aad, sodium.randombytes.buf(nonceBytes));

Uint8List open(Sodium sodium, SecureKey key, Uint8List blob, String aad) {
  if (blob.length < _minBlob || blob[0] != blobVersion) throw const CryptoError(CryptoErrorCode.badEnvelope);
  try {
    return sodium.crypto.aeadXChaCha20Poly1305IETF.decrypt(
      cipherText: Uint8List.sublistView(blob, 1 + nonceBytes),
      nonce: Uint8List.sublistView(blob, 1, 1 + nonceBytes),
      key: key,
      additionalData: Uint8List.fromList(utf8.encode(aad)),
    );
  } on SodiumException {
    throw const CryptoError(CryptoErrorCode.decryptFailed);
  }
}

Uint8List wrapVaultKey(Sodium sodium, SecureKey wrapKey, SecureKey vaultKey) =>
    vaultKey.runUnlockedSync((bytes) => seal(sodium, wrapKey, bytes, vaultKeyAad));

SecureKey unwrapVaultKey(Sodium sodium, SecureKey wrapKey, Uint8List wrapped) {
  final raw = open(sodium, wrapKey, wrapped, vaultKeyAad);
  try {
    if (raw.length != keyBytes) throw const CryptoError(CryptoErrorCode.decryptFailed);
    return SecureKey.fromList(sodium, raw);
  } finally {
    wipe(raw);
  }
}
