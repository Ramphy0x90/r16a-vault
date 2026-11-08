import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_client.dart';
import '../../core/api/api_error.dart';
import '../../core/prefs/prefs.dart';
import '../../core/session/session_service.dart';
import 'widgets.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _form = GlobalKey<FormState>();
  late final _server = TextEditingController(text: ref.read(prefsProvider).getString(PrefKeys.serverUrl) ?? '');
  final _username = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _server.dispose();
    _username.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_form.currentState?.validate() ?? false) || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(prefsProvider).setString(PrefKeys.serverUrl, normaliseServerUrl(_server.text)!);
      ref.invalidate(apiClientProvider);
      await ref.read(sessionServiceProvider).login(_username.text.trim(), _password.text);
      _password.clear();
    } catch (e) {
      _password.clear();
      if (mounted) setState(() => _error = messageFor(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _oidc() async {
    final server = normaliseServerUrl(_server.text);
    if (server == null) {
      setState(() => _error = 'Enter an https address for your server first.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(prefsProvider).setString(PrefKeys.serverUrl, server);
      ref.invalidate(apiClientProvider);
      final config = await ref.read(apiClientProvider).authConfig();
      if (config['oidcEnabled'] != true) {
        setState(() => _error = 'Single sign on is not enabled on this server.');
        return;
      }
      final mustRegister = await ref.read(sessionServiceProvider).signInWithOidc();
      if (mustRegister && mounted) context.go('/register');
    } catch (e) {
      if (mounted) setState(() => _error = e is StateError ? 'Single sign on could not be completed.' : messageFor(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AuthScaffold(
      title: 'Sign in',
      subtitle: 'Your vault is decrypted on this device only.',
      children: [
        Form(
          key: _form,
          child: AutofillGroup(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextFormField(
                  controller: _server,
                  keyboardType: TextInputType.url,
                  autocorrect: false,
                  decoration: const InputDecoration(labelText: 'Server address', hintText: 'vault.example.com'),
                  validator: (v) =>
                      normaliseServerUrl(v ?? '') == null ? 'Enter an https address for your server.' : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _username,
                  autocorrect: false,
                  enableSuggestions: false,
                  autofillHints: const [AutofillHints.username],
                  decoration: const InputDecoration(labelText: 'Username'),
                  validator: (v) => (v ?? '').trim().isEmpty ? 'Enter your username.' : null,
                ),
                const SizedBox(height: 12),
                PasswordField(
                  controller: _password,
                  label: 'Master password',
                  validator: (v) => (v ?? '').isEmpty ? 'Enter your master password.' : null,
                  onSubmitted: (_) => _submit(),
                ),
                const SizedBox(height: 16),
                if (_error != null) ...[ErrorBanner(_error!), const SizedBox(height: 12)],
                BusyButton(label: 'Sign in', busy: _busy, onPressed: _submit),
              ],
            ),
          ),
        ),
        const SizedBox(height: 8),
        OutlinedButton(onPressed: _busy ? null : _oidc, child: const Text('Sign in with single sign on')),
        TextButton(onPressed: () => context.go('/register'), child: const Text('Create an account')),
      ],
    );
  }
}
