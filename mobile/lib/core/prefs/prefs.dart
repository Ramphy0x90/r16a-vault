import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Non sensitive device preferences. The session token never goes here, it lives in
/// platform secure storage.
final prefsProvider = Provider<SharedPreferences>((ref) => throw UnimplementedError('overridden in main'));

class PrefKeys {
  static const serverUrl = 'r16a.serverUrl';
  static const theme = 'r16a.theme';
  static const autoLockMinutes = 'r16a.autolockMinutes';
}
