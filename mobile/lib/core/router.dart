import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/login_screen.dart';
import '../features/auth/register_screen.dart';
import '../features/auth/unlock_screen.dart';
import '../features/credentials/add_credential_screen.dart';
import '../features/credentials/credentials_screen.dart';
import '../features/generator/generator_screen.dart';
import '../features/settings/settings_screen.dart';
import '../features/shell/home_shell.dart';
import 'vault/vault_controller.dart';

/// Bridges Riverpod state into go_router so redirects re-run whenever the lock state changes.
class _VaultListenable extends ChangeNotifier {
  void ping() => notifyListeners();
}

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = _VaultListenable();
  ref.listen(vaultProvider, (prev, next) {
    if (prev?.status != next.status) refresh.ping();
  });
  ref.onDispose(refresh.dispose);

  const anonymousOnly = {'/login', '/register'};
  return GoRouter(
    initialLocation: '/vault',
    refreshListenable: refresh,
    redirect: (context, state) {
      final status = ref.read(vaultProvider).status;
      final loc = state.matchedLocation;
      return switch (status) {
        VaultStatus.unknown => null,
        VaultStatus.anonymous => anonymousOnly.contains(loc) ? null : '/login',
        VaultStatus.locked => loc == '/unlock' ? null : '/unlock',
        VaultStatus.unlocked => (anonymousOnly.contains(loc) || loc == '/unlock') ? '/vault' : null,
      };
    },
    routes: [
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(path: '/register', builder: (_, _) => const RegisterScreen()),
      GoRoute(path: '/unlock', builder: (_, _) => const UnlockScreen()),
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => HomeShell(shell: shell),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/vault',
                builder: (_, _) => const CredentialsScreen(),
                routes: [
                  GoRoute(
                    path: 'add',
                    builder: (_, state) => AddCredentialScreen(initialPassword: state.extra as String?),
                  ),
                ],
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [GoRoute(path: '/generator', builder: (_, _) => const GeneratorScreen())],
          ),
          StatefulShellBranch(
            routes: [GoRoute(path: '/settings', builder: (_, _) => const SettingsScreen())],
          ),
        ],
      ),
    ],
  );
});
