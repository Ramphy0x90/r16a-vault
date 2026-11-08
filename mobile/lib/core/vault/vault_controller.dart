import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:sodium/sodium_sumo.dart';

enum VaultStatus { unknown, anonymous, locked, unlocked }

class VaultState {
  const VaultState(this.status, {this.username, this.lockEpoch = 0});

  final VaultStatus status;
  final String? username;

  /// Increments on every lock so views holding decrypted secrets can drop them.
  final int lockEpoch;
}

final vaultProvider = NotifierProvider<VaultController, VaultState>(VaultController.new);

/// Lock state plus the in memory vault key. The key is a libsodium SecureKey in guarded
/// memory, it is disposed (and zeroed) on lock, and nothing ever writes it to storage.
class VaultController extends Notifier<VaultState> {
  SecureKey? _key;

  @override
  VaultState build() {
    ref.onDispose(_dispose);
    return const VaultState(VaultStatus.unknown);
  }

  void setUnlocked(String username, SecureKey key) {
    _dispose();
    _key = key;
    state = VaultState(VaultStatus.unlocked, username: username, lockEpoch: state.lockEpoch);
  }

  void setLocked(String username) {
    _dispose();
    state = VaultState(VaultStatus.locked, username: username, lockEpoch: state.lockEpoch + 1);
  }

  void setAnonymous() {
    _dispose();
    state = VaultState(VaultStatus.anonymous, lockEpoch: state.lockEpoch + 1);
  }

  void lock() {
    if (state.status == VaultStatus.unlocked) setLocked(state.username ?? '');
  }

  T withKey<T>(T Function(SecureKey key) fn) {
    final key = _key;
    if (key == null) throw StateError('vault is locked');
    return fn(key);
  }

  void _dispose() {
    _key?.dispose();
    _key = null;
  }
}
