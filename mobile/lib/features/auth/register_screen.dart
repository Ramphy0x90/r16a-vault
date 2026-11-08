import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_client.dart';
import '../../core/api/api_error.dart';
import '../../core/prefs/prefs.dart';
import '../../core/session/session_service.dart';
import '../../core/theme/theme.dart';
import 'widgets.dart';

const minMasterPassword = 12;
final _usernamePattern = RegExp(r'^[\p{L}\p{N}._-]{3,64}$', unicode: true);

class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _form = GlobalKey<FormState>();
  late final _server = TextEditingController(text: ref.read(prefsProvider).getString(PrefKeys.serverUrl) ?? '');
  late final _username = TextEditingController(
    text: ref.read(sessionServiceProvider).pendingOidc?.suggestedUsername ?? '',
  );
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  late final bool _oidc = ref.read(sessionServiceProvider).pendingOidc != null;
  bool _understood = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    for (final c in [_server, _username, _password, _confirm]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_form.currentState?.validate() ?? false) || _busy) return;
    if (!_understood) {
      setState(() => _error = 'Please confirm you understand that the master password cannot be recovered.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final session = ref.read(sessionServiceProvider);
      await session.useServer(_server.text);
      await session.register(_username.text.trim(), _password.text);
    } catch (e) {
      if (mounted) setState(() => _error = messageFor(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final warning = Theme.of(context).extension<Tokens>()!.warningText;
    return AuthScaffold(
      title: _oidc ? 'Finish signing in' : 'Create your vault',
      subtitle: _oidc ? 'Your identity was confirmed. Choose a username and master password.' : null,
      children: [
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            border: Border.all(color: warning),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Text.rich(
            TextSpan(
              children: [
                TextSpan(
                  text: 'Your master password cannot be recovered. ',
                  style: TextStyle(fontWeight: FontWeight.w700, color: warning),
                ),
                const TextSpan(
                  text:
                      'It never leaves this device and the server cannot reset it. If you forget it, everything in your vault is lost for good.',
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
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
                  autofillHints: const [AutofillHints.newUsername],
                  decoration: const InputDecoration(
                    labelText: 'Username',
                    helperText: '3 to 64 letters, digits, dots, hyphens or underscores',
                  ),
                  validator: (v) => _usernamePattern.hasMatch((v ?? '').trim()) ? null : 'Choose a valid username.',
                ),
                const SizedBox(height: 12),
                PasswordField(
                  controller: _password,
                  label: 'Master password',
                  autofillHints: const [AutofillHints.newPassword],
                  validator: (v) =>
                      (v ?? '').length < minMasterPassword ? 'Use at least $minMasterPassword characters.' : null,
                ),
                const SizedBox(height: 12),
                PasswordField(
                  controller: _confirm,
                  label: 'Confirm master password',
                  autofillHints: const [AutofillHints.newPassword],
                  validator: (v) => v != _password.text ? 'The passwords do not match.' : null,
                ),
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  value: _understood,
                  onChanged: (v) => setState(() => _understood = v ?? false),
                  title: const Text('I understand my master password cannot be recovered.'),
                  controlAffinity: ListTileControlAffinity.leading,
                ),
                if (_error != null) ...[ErrorBanner(_error!), const SizedBox(height: 12)],
                BusyButton(label: 'Create account', busy: _busy, onPressed: _submit),
              ],
            ),
          ),
        ),
        const SizedBox(height: 8),
        TextButton(onPressed: () => context.go('/login'), child: const Text('Already have an account? Sign in')),
      ],
    );
  }
}
