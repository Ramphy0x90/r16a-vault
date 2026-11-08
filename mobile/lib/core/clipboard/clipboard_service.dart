import 'dart:async';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../vault/vault_controller.dart';

const clipboardClearDelay = Duration(seconds: 30);

/// Created at startup by the app widget, so the lock and resume hooks are always attached.
final clipboardServiceProvider = Provider<ClipboardService>((ref) {
  final service = ClipboardService();
  ref.listen(vaultProvider.select((s) => s.lockEpoch), (_, _) => service.clearIfOurs());
  final lifecycle = AppLifecycleListener(onResume: service.onResume);
  ref.onDispose(() {
    lifecycle.dispose();
    service.dispose();
  });
  return service;
});

/// Copies secrets and clears them after 30 seconds if the clipboard still holds them.
///
/// On Android and iOS the copy goes through a small platform channel. Android 13+ flags the
/// clip as sensitive. iOS keeps it off Universal Clipboard and lets the system expire it after
/// 30 seconds even while the app is suspended. Clearing compares the platform's change marker
/// instead of reading the clipboard, so no paste prompt or toast appears. Timers do not run
/// while the app is suspended, so the deadline is also checked on resume, and locking clears
/// immediately.
class ClipboardService {
  static const _channel = MethodChannel('dev.r16a.vault/clipboard');
  Timer? _timer;
  DateTime? _deadline;
  bool _native = false;
  String? _fallbackValue;

  Future<void> copy(String value, {bool sensitive = true}) async {
    var native = false;
    if (sensitive && (Platform.isAndroid || Platform.isIOS)) {
      try {
        native = await _channel.invokeMethod<bool>('copySensitive', {'text': value}) ?? false;
      } on PlatformException {
        native = false;
      } on MissingPluginException {
        native = false;
      }
    }
    if (!native) await Clipboard.setData(ClipboardData(text: value));
    if (!sensitive) return;
    _native = native;
    _fallbackValue = native ? null : value;
    _deadline = DateTime.now().add(clipboardClearDelay);
    _timer?.cancel();
    _timer = Timer(clipboardClearDelay, clearIfOurs);
  }

  void onResume() {
    final deadline = _deadline;
    if (deadline != null && DateTime.now().isAfter(deadline)) clearIfOurs();
  }

  Future<void> clearIfOurs() async {
    if (_deadline == null) return;
    _timer?.cancel();
    _timer = null;
    _deadline = null;
    if (_native) {
      try {
        await _channel.invokeMethod<bool>('clearIfOurs');
      } on Exception {
        // The secret still expires through the platform where supported.
      }
      return;
    }
    final value = _fallbackValue;
    _fallbackValue = null;
    final current = await Clipboard.getData(Clipboard.kTextPlain);
    if (current?.text == null || current?.text == value) {
      await Clipboard.setData(const ClipboardData(text: ''));
    }
  }

  void dispose() => _timer?.cancel();
}
