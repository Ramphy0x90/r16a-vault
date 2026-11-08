import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_error.dart';
import '../../core/security/secure_screen.dart';
import '../../core/session/session_service.dart';
import '../../core/vault/vault_controller.dart';
import 'widgets.dart';

class UnlockScreen extends ConsumerStatefulWidget {
  const UnlockScreen({super.key});

  @override
  ConsumerState<UnlockScreen> createState() => _UnlockScreenState();
}

class _UnlockScreenState extends ConsumerState<UnlockScreen> {
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_password.text.isEmpty || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(sessionServiceProvider).unlock(_password.text);
    } catch (e) {
      if (mounted) setState(() => _error = messageFor(e));
    } finally {
      _password.clear();
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final username = ref.watch(vaultProvider.select((s) => s.username)) ?? '';
    return SecureScreen(
      child: AuthScaffold(
        title: 'Unlock your vault',
        subtitle: 'Signed in as $username',
        children: [
          PasswordField(controller: _password, label: 'Master password', onSubmitted: (_) => _submit()),
          const SizedBox(height: 16),
          if (_error != null) ...[ErrorBanner(_error!), const SizedBox(height: 12)],
          BusyButton(label: 'Unlock', busy: _busy, onPressed: _submit),
          const SizedBox(height: 8),
          TextButton(onPressed: () => ref.read(sessionServiceProvider).logout(), child: const Text('Sign out')),
        ],
      ),
    );
  }
}
