import 'dart:async';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

const clipboardClearDelay = Duration(seconds: 30);

final clipboardServiceProvider = Provider<ClipboardService>((ref) => ClipboardService());

/// Copies secrets and clears them after 30 seconds if the clipboard still holds them.
/// On Android 13 and later secrets are also flagged as sensitive, which hides them from the
/// clipboard preview and keyboard suggestions.
class ClipboardService {
  static const _channel = MethodChannel('dev.r16a.vault/clipboard');
  Timer? _timer;

  Future<void> copy(String value, {bool sensitive = true}) async {
    var done = false;
    if (sensitive && Platform.isAndroid) {
      try {
        done = await _channel.invokeMethod<bool>('copySensitive', {'text': value}) ?? false;
      } on PlatformException {
        done = false;
      } on MissingPluginException {
        done = false;
      }
    }
    if (!done) await Clipboard.setData(ClipboardData(text: value));
    if (!sensitive) return;
    _timer?.cancel();
    _timer = Timer(clipboardClearDelay, () async {
      final current = await Clipboard.getData(Clipboard.kTextPlain);
      if (current?.text == null || current?.text == value) {
        await Clipboard.setData(const ClipboardData(text: ''));
      }
    });
  }
}
