import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart' show sha256;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_web_auth_2/flutter_web_auth_2.dart';

import '../api/api_client.dart';
import '../api/dto.dart';
import '../crypto/protocol.dart';
import '../crypto/vault_crypto.dart';
import '../prefs/prefs.dart';
import '../vault/vault_controller.dart';
import 'token_store.dart';

final sessionServiceProvider = Provider<SessionService>((ref) => SessionService(ref));

class _Me {
  const _Me(this.username, this.salt, this.kdf);
  final String username;
  final String salt;
  final KdfParams kdf;
}

/// Every flow that involves the master password. Intermediate keys are disposed before
/// each method returns, whatever the outcome.
class SessionService {
  SessionService(this._ref);

  final Ref _ref;
  _Me? _me;

  /// Set after a first OIDC sign in. Registration then links the new account to that identity.
  ({String token, String? suggestedUsername})? pendingOidc;

  static const oidcScheme = 'r16avault';

  ApiClient get _api => _ref.read(apiClientProvider);
  TokenStore get _tokens => _ref.read(tokenStoreProvider);
  VaultController get _vault => _ref.read(vaultProvider.notifier);
  Future<VaultCrypto> get _crypto => _ref.read(vaultCryptoProvider.future);

  /// Restores a stored session as locked, or falls back to anonymous.
  Future<void> bootstrap() async {
    if (await _tokens.read() == null) {
      _vault.setAnonymous();
      return;
    }
    try {
      final me = await _api.me();
      _me = _Me(me.username, me.salt, me.kdf);
      _vault.setLocked(me.username);
    } catch (_) {
      await _tokens.clear();
      _vault.setAnonymous();
    }
  }

  Future<void> register(String username, String password) async {
    final crypto = await _crypto;
    final vaultKey = crypto.newVaultKey();
    try {
      final m = await crypto.createKeyMaterial(password, vaultKey);
      final res = await _api.register(
        username: username,
        authKey: m.authKey,
        kdf: m.kdf,
        salt: m.salt,
        wrappedVaultKey: m.wrappedVaultKey,
        oidcPendingToken: pendingOidc?.token,
      );
      pendingOidc = null;
      await _adopt(res);
      _vault.setUnlocked(res.username, vaultKey);
    } catch (_) {
      vaultKey.dispose();
      rethrow;
    }
  }

  Future<void> login(String username, String password) async {
    final crypto = await _crypto;
    final pre = await _api.prelogin(username);
    final keys = await crypto.deriveSubkeys(password, pre.salt, pre.kdf);
    try {
      final res = await _api.login(username, crypto.authKeyB64(keys));
      final vaultKey = crypto.unwrap(keys, res.wrappedVaultKey);
      await _adopt(res);
      _vault.setUnlocked(res.username, vaultKey);
    } finally {
      keys.dispose();
    }
  }

  Future<void> unlock(String password) async {
    final crypto = await _crypto;
    final me = await _currentMe();
    final keys = await crypto.deriveSubkeys(password, me.salt, me.kdf);
    try {
      final res = await _api.unlock(crypto.authKeyB64(keys));
      final vaultKey = crypto.unwrap(keys, res.wrappedVaultKey);
      final token = res.token;
      if (token != null) await _tokens.write(token);
      _me = _Me(me.username, res.salt, res.kdf);
      _vault.setUnlocked(me.username, vaultKey);
    } finally {
      keys.dispose();
    }
  }

  /// Runs the system browser sign in. The app keeps a PKCE style verifier, so the one time
  /// code that comes back through the custom scheme is useless to any other app.
  /// Returns true when the user still has to register.
  Future<bool> signInWithOidc() async {
    final rng = Random.secure();
    final verifier = base64Url.encode(List<int>.generate(48, (_) => rng.nextInt(256))).replaceAll('=', '');
    final challenge = base64Url.encode(sha256.convert(utf8.encode(verifier)).bytes).replaceAll('=', '');
    final server = _ref.read(prefsProvider).getString(PrefKeys.serverUrl) ?? '';
    final result = await FlutterWebAuth2.authenticate(
      url: '$server/api/v1/auth/oidc/start?client=mobile&challenge=$challenge',
      callbackUrlScheme: oidcScheme,
    );
    final params = Uri.parse(result).queryParameters;
    final code = params['code'];
    if (code == null) throw StateError(params['error'] ?? 'oidc-failed');
    final res = await _api.oidcExchange(code, verifier);
    if (res.pending) {
      pendingOidc = (token: res.token, suggestedUsername: res.suggestedUsername);
      return true;
    }
    await _tokens.write(res.token);
    await bootstrap();
    return false;
  }

  /// Points the app at a server. The address is validated and stored, and the API client is
  /// rebuilt so the next request goes to the new server.
  Future<void> useServer(String input) async {
    final url = normaliseServerUrl(input);
    if (url == null) throw const FormatException('invalid server address');
    if (url != _ref.read(prefsProvider).getString(PrefKeys.serverUrl)) {
      await _ref.read(prefsProvider).setString(PrefKeys.serverUrl, url);
      _ref.invalidate(apiClientProvider);
    }
  }

  Future<bool> oidcEnabled() async => (await _api.authConfig())['oidcEnabled'] == true;

  void lock() => _vault.lock();

  Future<void> logout() async {
    try {
      await _api.logout();
    } catch (_) {
      // Local state is cleared regardless. The server session then simply expires.
    }
    await _reset();
  }

  Future<void> changeMasterPassword(String current, String next) async {
    final crypto = await _crypto;
    final me = await _currentMe();
    final keys = await crypto.deriveSubkeys(current, me.salt, me.kdf);
    try {
      final currentAuthKey = crypto.authKeyB64(keys);
      final material = await _vault.withKey((vk) => crypto.createKeyMaterial(next, vk));
      await _api.changeMasterPassword({
        'currentAuthKey': currentAuthKey,
        'newAuthKey': material.authKey,
        'newSalt': material.salt,
        'newKdf': material.kdf.toJson(),
        'newWrappedVaultKey': material.wrappedVaultKey,
      });
      _me = _Me(me.username, material.salt, material.kdf);
    } finally {
      keys.dispose();
    }
  }

  Future<void> logoutAll(String password) async {
    await _prove(password, _api.logoutAll);
    await _reset();
  }

  Future<void> deleteAccount(String password) async {
    await _prove(password, _api.deleteAccount);
    await _reset();
  }

  Future<void> handleExpiry() async {
    if (_ref.read(vaultProvider).status == VaultStatus.anonymous) return;
    await _reset();
  }

  Future<void> _prove(String password, Future<void> Function(String authKey) action) async {
    final crypto = await _crypto;
    final me = await _currentMe();
    final keys = await crypto.deriveSubkeys(password, me.salt, me.kdf);
    try {
      await action(crypto.authKeyB64(keys));
    } finally {
      keys.dispose();
    }
  }

  Future<_Me> _currentMe() async {
    final cached = _me;
    if (cached != null) return cached;
    final me = await _api.me();
    return _me = _Me(me.username, me.salt, me.kdf);
  }

  Future<void> _adopt(SignedIn res) async {
    await _tokens.write(res.token);
    _me = _Me(res.username, res.salt, res.kdf);
  }

  Future<void> _reset() async {
    _me = null;
    await _tokens.clear();
    _vault.setAnonymous();
  }
}
