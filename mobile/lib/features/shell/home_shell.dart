import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/autolock/auto_lock.dart';
import '../../core/security/secure_screen.dart';
import '../../core/session/session_service.dart';

/// Frame for the unlocked area. Screenshot protection and auto lock apply to every tab.
class HomeShell extends ConsumerWidget {
  const HomeShell({super.key, required this.shell});

  final StatefulNavigationShell shell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return SecureScreen(
      child: AutoLockScope(
        child: Scaffold(
          body: shell,
          bottomNavigationBar: NavigationBar(
            selectedIndex: shell.currentIndex,
            onDestinationSelected: (i) {
              if (i == 3) {
                ref.read(sessionServiceProvider).lock();
              } else {
                shell.goBranch(i, initialLocation: i == shell.currentIndex);
              }
            },
            destinations: const [
              NavigationDestination(icon: Icon(Icons.key_outlined), selectedIcon: Icon(Icons.key), label: 'Vault'),
              NavigationDestination(
                icon: Icon(Icons.casino_outlined),
                selectedIcon: Icon(Icons.casino),
                label: 'Generator',
              ),
              NavigationDestination(
                icon: Icon(Icons.settings_outlined),
                selectedIcon: Icon(Icons.settings),
                label: 'Settings',
              ),
              NavigationDestination(icon: Icon(Icons.lock_outline), label: 'Lock'),
            ],
          ),
        ),
      ),
    );
  }
}
