import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tabler_icons_next/tabler_icons_next.dart' as tabler;

import '../../core/autolock/auto_lock.dart';
import '../../core/security/secure_screen.dart';
import '../../core/session/session_service.dart';
import '../../core/ui/tabler_icon.dart';

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
              NavigationDestination(icon: TIcon(tabler.Key()), selectedIcon: TIcon(tabler.Key()), label: 'Vault'),
              NavigationDestination(icon: TIcon(tabler.Wand()), selectedIcon: TIcon(tabler.Wand()), label: 'Generator'),
              NavigationDestination(
                icon: TIcon(tabler.Settings()),
                selectedIcon: TIcon(tabler.Settings()),
                label: 'Settings',
              ),
              NavigationDestination(icon: TIcon(tabler.Lock()), label: 'Lock'),
            ],
          ),
        ),
      ),
    );
  }
}
