/// Runs the real mobile session flows against a live server. Skipped unless R16A_LIVE_URL is
/// set, for example `R16A_LIVE_URL=http://localhost:8080 flutter test test/live_api_test.dart`.
@Tags(['live'])
library;

import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:r16a_vault/core/api/api_error.dart';
import 'package:r16a_vault/core/prefs/prefs.dart';
import 'package:r16a_vault/core/session/session_service.dart';
import 'package:r16a_vault/core/session/token_store.dart';
import 'package:r16a_vault/core/vault/vault_controller.dart';
import 'package:r16a_vault/features/credentials/credentials_controller.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Keeps the token in memory, because platform secure storage is unavailable in tests.
class _MemoryTokens extends TokenStore {
  _MemoryTokens() : super(const FlutterSecureStorage());
  String? _token;

  @override
  Future<String?> read() async => _token;

  @override
  Future<void> write(String token) async => _token = token;

  @override
  Future<void> clear() async => _token = null;
}

void main() {
  final base = Platform.environment['R16A_LIVE_URL'];

  test(
    'register, add, decrypt, lock, unlock, change password, delete',
    () async {
      SharedPreferences.setMockInitialValues({PrefKeys.serverUrl: base!});
      final prefs = await SharedPreferences.getInstance();
      final container = ProviderContainer(
        overrides: [prefsProvider.overrideWithValue(prefs), tokenStoreProvider.overrideWithValue(_MemoryTokens())],
      );
      addTearDown(container.dispose);
      final session = container.read(sessionServiceProvider);
      final user = 'mobile_${DateTime.now().millisecondsSinceEpoch.toRadixString(36)}';
      const pw = 'mobile master passphrase 2026';
      const pw2 = 'another mobile passphrase 2027';

      await session.register(user, pw);
      expect(container.read(vaultProvider).status, VaultStatus.unlocked);

      final creds = container.read(credentialsProvider.notifier);
      await container.read(credentialsProvider.future);
      await creds.add(
        name: 'Bank',
        url: 'https://bank.example/',
        username: 'alice',
        password: 'Mob1le-S3cret',
        mfaSecret: 'JBSWY3DPEHPK3PXP',
      );
      final list = container.read(credentialsProvider).value!;
      expect(list.single.meta!.name, 'Bank');
      expect((await creds.openSecret(list.single.id)).password, 'Mob1le-S3cret');

      session.lock();
      expect(container.read(vaultProvider).status, VaultStatus.locked);
      await expectLater(session.unlock('wrong password entirely'), throwsA(isA<ApiError>()));
      await session.unlock(pw);
      final relisted = await container.read(credentialsProvider.future);
      expect(relisted.single.meta!.username, 'alice');

      await session.changeMasterPassword(pw, pw2);
      await session.logout();
      expect(container.read(vaultProvider).status, VaultStatus.anonymous);
      await expectLater(session.login(user, pw), throwsA(isA<ApiError>()));
      await session.login(user, pw2);
      final afterChange = await container.read(credentialsProvider.future);
      expect((await creds.openSecret(afterChange.single.id)).mfaSecret, 'JBSWY3DPEHPK3PXP');

      await creds.remove(afterChange.single.id);
      await session.deleteAccount(pw2);
      expect(container.read(vaultProvider).status, VaultStatus.anonymous);
    },
    skip: base == null ? 'set R16A_LIVE_URL to run against a server' : false,
    timeout: const Timeout(Duration(minutes: 2)),
  );
}
