import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../prefs/prefs.dart';
import '../session/session_service.dart';

const autoLockChoices = [1, 5, 15, 30];
const defaultAutoLockMinutes = 5;
const backgroundGrace = Duration(seconds: 30);

/// Announces user input that produces no pointer event, such as typing on the soft keyboard.
/// Forms dispatch it on every change, and the auto lock scope treats it as activity.
class UserActivity extends Notification {
  const UserActivity();
}

final autoLockMinutesProvider = NotifierProvider<AutoLockMinutes, int>(AutoLockMinutes.new);

class AutoLockMinutes extends Notifier<int> {
  @override
  int build() {
    final v = ref.read(prefsProvider).getInt(PrefKeys.autoLockMinutes);
    return autoLockChoices.contains(v) ? v! : defaultAutoLockMinutes;
  }

  void set(int minutes) {
    if (!autoLockChoices.contains(minutes)) return;
    state = minutes;
    ref.read(prefsProvider).setInt(PrefKeys.autoLockMinutes, minutes);
  }
}

/// Locks after inactivity and when the app stays in the background past a grace period.
/// Timers do not run while the OS suspends the app, so the background check compares
/// timestamps on resume instead of relying on a timer.
class AutoLockScope extends ConsumerStatefulWidget {
  const AutoLockScope({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<AutoLockScope> createState() => _AutoLockScopeState();
}

class _AutoLockScopeState extends ConsumerState<AutoLockScope> {
  Timer? _idle;
  DateTime? _hiddenAt;
  late final AppLifecycleListener _lifecycle;

  @override
  void initState() {
    super.initState();
    _lifecycle = AppLifecycleListener(onHide: () => _hiddenAt ??= DateTime.now(), onShow: _onShow, onDetach: _lock);
    _restart();
  }

  void _onShow() {
    final since = _hiddenAt;
    _hiddenAt = null;
    if (since != null && DateTime.now().difference(since) > backgroundGrace) {
      _lock();
    } else {
      _restart();
    }
  }

  void _restart() {
    _idle?.cancel();
    _idle = Timer(Duration(minutes: ref.read(autoLockMinutesProvider)), _lock);
  }

  void _lock() => ref.read(sessionServiceProvider).lock();

  @override
  void dispose() {
    _idle?.cancel();
    _lifecycle.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(autoLockMinutesProvider, (_, _) => _restart());
    return NotificationListener<UserActivity>(
      onNotification: (_) {
        _restart();
        return true;
      },
      child: Listener(behavior: HitTestBehavior.translucent, onPointerDown: (_) => _restart(), child: widget.child),
    );
  }
}
