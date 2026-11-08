import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// This device only keychain items are excluded from iOS backups and never restored onto
/// another device, so the session token stays where it was issued.
final tokenStoreProvider = Provider<TokenStore>(
  (ref) => TokenStore(
    const FlutterSecureStorage(iOptions: IOSOptions(accessibility: KeychainAccessibility.unlocked_this_device)),
  ),
);

/// The session token is the only secret persisted on the device. It grants a locked
/// session, the vault key is never stored.
class TokenStore {
  TokenStore(this._storage);

  final FlutterSecureStorage _storage;
  static const _key = 'r16a.session';
  String? _cached;

  Future<String?> read() async => _cached ??= await _storage.read(key: _key);

  Future<void> write(String token) async {
    _cached = token;
    await _storage.write(key: _key, value: token);
  }

  Future<void> clear() async {
    _cached = null;
    await _storage.delete(key: _key);
  }
}
