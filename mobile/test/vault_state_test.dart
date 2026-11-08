import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:r16a_vault/core/api/api_client.dart';
import 'package:r16a_vault/core/api/dto.dart';
import 'package:r16a_vault/core/crypto/vault_crypto.dart';
import 'package:r16a_vault/core/session/token_store.dart';
import 'package:r16a_vault/core/vault/vault_controller.dart';
import 'package:r16a_vault/features/credentials/credentials_controller.dart';
import 'package:sodium/sodium_sumo.dart';

/// Serves one credential sealed with the test vault key and counts list calls.
class _FakeApi extends ApiClient {
  _FakeApi(this.rows)
    : super(baseUrl: 'http://localhost', tokens: TokenStore(const FlutterSecureStorage()), onExpired: _noop);

  final List<CredentialRow> rows;
  int listCalls = 0;

  @override
  Future<List<CredentialRow>> listCredentials() async {
    listCalls++;
    return rows;
  }
}

void _noop() {}

void main() {
  late SodiumSumo sodium;
  setUpAll(() async => sodium = await SodiumSumoInit.init());

  test('locking wipes the vault key and blocks access to it', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final vault = container.read(vaultProvider.notifier);
    vault.setUnlocked('alice', SecureKey.random(sodium, 32));
    expect(vault.withKey((k) => k.length), 32);
    vault.lock();
    expect(container.read(vaultProvider).status, VaultStatus.locked);
    expect(() => vault.withKey((k) => k.length), throwsStateError);
  });

  test('the credential list is dropped on lock and loaded again on unlock', () async {
    final crypto = VaultCrypto(sodium);
    final key = SecureKey.random(sodium, 32);
    const id = '0192f6c8-4b2a-4e7d-9a51-3c9e1d7b2a10';
    final sealed = crypto.sealCredential(
      key,
      id,
      const CredentialMeta(name: 'Mail', url: null, username: 'alice'),
      const CredentialSecret(password: 'pw', mfaSecret: null),
    );
    final api = _FakeApi([
      CredentialRow.fromJson({'id': id, 'meta': sealed.meta, 'secret': sealed.secret}),
    ]);
    final container = ProviderContainer(
      overrides: [apiClientProvider.overrideWithValue(api), vaultCryptoProvider.overrideWith((ref) async => crypto)],
    );
    addTearDown(container.dispose);
    // Keep the provider alive across the lock, as a mounted screen would.
    container.listen(credentialsProvider, (_, _) {}, fireImmediately: true);
    final vault = container.read(vaultProvider.notifier);

    vault.setUnlocked('alice', SecureKey.fromList(sodium, key.extractBytes()));
    expect((await container.read(credentialsProvider.future)).single.meta!.name, 'Mail');

    vault.lock();
    expect(await container.read(credentialsProvider.future), isEmpty);

    vault.setUnlocked('alice', SecureKey.fromList(sodium, key.extractBytes()));
    final reloaded = await container.read(credentialsProvider.future);
    expect(reloaded.single.meta!.username, 'alice', reason: 'unlock must reload the list');
    expect(api.listCalls, 2);
  });
}
