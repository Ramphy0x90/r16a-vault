import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/data.dart';
import 'package:uuid/rng.dart';
import 'package:uuid/uuid.dart';

import '../../core/api/api_client.dart';
import '../../core/crypto/vault_crypto.dart';
import '../../core/vault/vault_controller.dart';

class CredentialEntry {
  const CredentialEntry({required this.id, required this.meta, required this.secretBlob});

  final String id;

  /// Null when the row failed to decrypt. The list shows it rather than hiding it.
  final CredentialMeta? meta;
  final String secretBlob;
}

final credentialsProvider = AsyncNotifierProvider<CredentialsController, List<CredentialEntry>>(
  CredentialsController.new,
);

/// Decrypted credential list. Only meta blobs are opened here. The list is dropped on every
/// lock and loaded again on unlock.
class CredentialsController extends AsyncNotifier<List<CredentialEntry>> {
  static const _uuid = Uuid();

  @override
  Future<List<CredentialEntry>> build() async {
    // Both matter. The epoch drops state on every lock, the status reloads on unlock, which
    // leaves the epoch unchanged.
    final unlocked = ref.watch(vaultProvider.select((s) => (s.lockEpoch, s.status == VaultStatus.unlocked))).$2;
    if (!unlocked) return const [];
    final crypto = await ref.read(vaultCryptoProvider.future);
    final rows = await ref.read(apiClientProvider).listCredentials();
    final vault = ref.read(vaultProvider.notifier);
    return [
      for (final r in rows)
        CredentialEntry(
          id: r.id,
          secretBlob: r.secret,
          meta: _tryOpen(() => vault.withKey((k) => crypto.openMeta(k, r.id, r.meta))),
        ),
    ];
  }

  CredentialMeta? _tryOpen(CredentialMeta Function() fn) {
    try {
      return fn();
    } catch (_) {
      return null;
    }
  }

  Future<void> add({
    required String name,
    String? url,
    required String username,
    required String password,
    String? mfaSecret,
  }) async {
    final crypto = await ref.read(vaultCryptoProvider.future);
    // Version 4 ids come from a cryptographic random source and reveal nothing about timing.
    final id = _uuid.v4(config: const V4Options(null, CryptoRNG()));
    final meta = CredentialMeta(name: name, url: url, username: username, hasTotp: mfaSecret != null);
    final sealed = ref
        .read(vaultProvider.notifier)
        .withKey((k) => crypto.sealCredential(k, id, meta, CredentialSecret(password: password, mfaSecret: mfaSecret)));
    final row = await ref.read(apiClientProvider).createCredential(id, sealed.meta, sealed.secret);
    final current = state.value ?? const [];
    state = AsyncData([...current, CredentialEntry(id: id, meta: meta, secretBlob: row.secret)]);
  }

  Future<void> remove(String id) async {
    await ref.read(apiClientProvider).deleteCredential(id);
    state = AsyncData([...?state.value?.where((e) => e.id != id)]);
  }

  Future<CredentialSecret> openSecret(String id) async {
    final crypto = await ref.read(vaultCryptoProvider.future);
    final entry = (state.value ?? const []).firstWhere((e) => e.id == id);
    return ref.read(vaultProvider.notifier).withKey((k) => crypto.openSecret(k, id, entry.secretBlob));
  }
}

/// The search text of the vault list. Reset with every lock, like the list itself.
final credentialQueryProvider = NotifierProvider<CredentialQuery, String>(CredentialQuery.new);

class CredentialQuery extends Notifier<String> {
  @override
  String build() {
    ref.watch(vaultProvider.select((s) => s.lockEpoch));
    return '';
  }

  void set(String value) => state = value;
}

/// The list as shown, sorted by name and filtered by the search text.
final visibleCredentialsProvider = Provider<AsyncValue<List<CredentialEntry>>>((ref) {
  final query = ref.watch(credentialQueryProvider).trim().toLowerCase();
  return ref.watch(credentialsProvider).whenData((list) {
    final sorted = [...list]
      ..sort((a, b) => (a.meta?.name ?? '').toLowerCase().compareTo((b.meta?.name ?? '').toLowerCase()));
    if (query.isEmpty) return sorted;
    return sorted.where((e) {
      final m = e.meta;
      return m != null && [m.name, m.username, m.url ?? ''].any((f) => f.toLowerCase().contains(query));
    }).toList();
  });
});
