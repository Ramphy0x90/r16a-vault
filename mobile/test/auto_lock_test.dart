import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:r16a_vault/core/autolock/auto_lock.dart';
import 'package:r16a_vault/core/prefs/prefs.dart';
import 'package:r16a_vault/core/session/session_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _CountingSession implements SessionService {
  int locks = 0;

  @override
  void lock() => locks++;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  testWidgets('locks after inactivity, typing and taps postpone it', (tester) async {
    SharedPreferences.setMockInitialValues({PrefKeys.autoLockMinutes: 1});
    final prefs = await SharedPreferences.getInstance();
    final session = _CountingSession();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [prefsProvider.overrideWithValue(prefs), sessionServiceProvider.overrideWithValue(session)],
        child: MaterialApp(
          home: AutoLockScope(
            child: Scaffold(
              body: Builder(
                builder: (context) => Form(
                  onChanged: () => const UserActivity().dispatch(context),
                  child: TextFormField(key: const Key('field')),
                ),
              ),
            ),
          ),
        ),
      ),
    );

    await tester.pump(const Duration(seconds: 50));
    await tester.enterText(find.byKey(const Key('field')), 'typing');
    await tester.pump(const Duration(seconds: 50));
    expect(session.locks, 0, reason: 'typing counts as activity');

    await tester.tap(find.byKey(const Key('field')));
    await tester.pump(const Duration(seconds: 59));
    expect(session.locks, 0, reason: 'a tap restarts the timer');
    await tester.pump(const Duration(seconds: 2));
    expect(session.locks, 1);
  });
}
