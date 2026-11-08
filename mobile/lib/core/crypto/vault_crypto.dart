import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:sodium/sodium_sumo.dart';

import 'protocol.dart';

/// Decrypted credential list fields. Only these are opened when the list is shown.
class CredentialMeta {
  const CredentialMeta({required this.name, required this.url, required this.username, this.hasTotp = false});

  final String name;
  final String? url;
  final String username;
  final bool hasTotp;

  Map<String, dynamic> toJson() => {'name': name, 'url': url, 'username': username, 'hasTotp': hasTotp};
}

/// Opened only on reveal, copy or TOTP display, and dropped right after.
class CredentialSecret {
  const CredentialSecret({required this.password, required this.mfaSecret});

  final String password;
  final String? mfaSecret;

  Map<String, dynamic> toJson() => {'password': password, 'mfaSecret': mfaSecret};
}

class KeyMaterial {
  const KeyMaterial({required this.authKey, required this.salt, required this.kdf, required this.wrappedVaultKey});

  final String authKey;
  final String salt;
  final KdfParams kdf;
  final String wrappedVaultKey;
}

final sodiumProvider = FutureProvider<SodiumSumo>((ref) => SodiumSumoInit.init());

final vaultCryptoProvider = FutureProvider<VaultCrypto>(
  (ref) async => VaultCrypto(await ref.watch(sodiumProvider.future)),
);

/// Every vault crypto operation of the mobile client. Widgets never see raw keys, they pass
/// and receive domain values and base64 strings.
class VaultCrypto {
  VaultCrypto(this.sodium);

  final SodiumSumo sodium;

  /// Argon2id runs in a background isolate so the UI keeps animating. The isolate builds
  /// its own libsodium instance and hands the key back as a transferable secure key, so it
  /// never exists as a plain Dart list on the way.
  Future<Subkeys> deriveSubkeys(String password, String saltB64, KdfParams kdf) async {
    if (!kdf.acceptable) throw const CryptoError(CryptoErrorCode.kdfRejected);
    final salt = base64.decode(saltB64);
    if (salt.length != saltBytes) throw const CryptoError(CryptoErrorCode.badEnvelope);
    final pw = passwordBytes(password);
    final ops = kdf.opslimit;
    final mem = kdf.memlimit;
    try {
      final transferable = await sodium.runIsolated<TransferrableSecureKey>((_, _) async {
        final isolated = await SodiumSumoInit.init();
        final key = stretch(isolated, pw, Uint8List.fromList(salt), KdfParams(opslimit: ops, memlimit: mem));
        try {
          return isolated.createTransferrableSecureKey(key);
        } finally {
          key.dispose();
          // The isolate received its own copy of the password bytes.
          wipe(pw);
        }
      });
      return splitMasterKey(sodium, sodium.materializeTransferrableSecureKey(transferable));
    } finally {
      wipe(pw);
    }
  }

  String authKeyB64(Subkeys keys) => keys.authKey.runUnlockedSync((b) => base64.encode(b));

  SecureKey newVaultKey() => SecureKey.random(sodium, keyBytes);

  Future<KeyMaterial> createKeyMaterial(String password, SecureKey vaultKey) async {
    final salt = base64.encode(sodium.randombytes.buf(saltBytes));
    final keys = await deriveSubkeys(password, salt, KdfParams.defaults);
    try {
      return KeyMaterial(
        authKey: authKeyB64(keys),
        salt: salt,
        kdf: KdfParams.defaults,
        wrappedVaultKey: base64.encode(wrapVaultKey(sodium, keys.wrapKey, vaultKey)),
      );
    } finally {
      keys.dispose();
    }
  }

  SecureKey unwrap(Subkeys keys, String wrappedB64) => unwrapVaultKey(sodium, keys.wrapKey, _decode(wrappedB64));

  ({String meta, String secret}) sealCredential(
    SecureKey vaultKey,
    String id,
    CredentialMeta meta,
    CredentialSecret secret,
  ) {
    final metaPlain = Uint8List.fromList(utf8.encode(jsonEncode(meta.toJson())));
    final secretPlain = Uint8List.fromList(utf8.encode(jsonEncode(secret.toJson())));
    try {
      return (
        meta: base64.encode(seal(sodium, vaultKey, metaPlain, credentialAad(id, 'meta'))),
        secret: base64.encode(seal(sodium, vaultKey, secretPlain, credentialAad(id, 'secret'))),
      );
    } finally {
      wipe(metaPlain);
      wipe(secretPlain);
    }
  }

  CredentialMeta openMeta(SecureKey vaultKey, String id, String blobB64) {
    final v = _openJson(vaultKey, id, 'meta', blobB64);
    final name = v['name'];
    final username = v['username'];
    if (name is! String || username is! String) throw const CryptoError(CryptoErrorCode.decryptFailed);
    final url = v['url'];
    return CredentialMeta(
      name: name,
      username: username,
      url: url is String ? url : null,
      hasTotp: v['hasTotp'] == true,
    );
  }

  CredentialSecret openSecret(SecureKey vaultKey, String id, String blobB64) {
    final v = _openJson(vaultKey, id, 'secret', blobB64);
    final password = v['password'];
    if (password is! String) throw const CryptoError(CryptoErrorCode.decryptFailed);
    final mfa = v['mfaSecret'];
    return CredentialSecret(password: password, mfaSecret: mfa is String ? mfa : null);
  }

  Map<String, dynamic> _openJson(SecureKey key, String id, String field, String blobB64) {
    final plain = open(sodium, key, _decode(blobB64), credentialAad(id, field));
    try {
      final decoded = jsonDecode(utf8.decode(plain));
      if (decoded is! Map<String, dynamic>) throw const CryptoError(CryptoErrorCode.decryptFailed);
      return decoded;
    } on FormatException {
      throw const CryptoError(CryptoErrorCode.decryptFailed);
    } finally {
      wipe(plain);
    }
  }

  Uint8List _decode(String b64) {
    try {
      return base64.decode(b64);
    } on FormatException {
      throw const CryptoError(CryptoErrorCode.badEnvelope);
    }
  }
}
