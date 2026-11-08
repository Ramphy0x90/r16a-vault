import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_error.dart';
import '../../core/totp/totp.dart';
import '../auth/widgets.dart';
import '../generator/generator_controller.dart';
import '../generator/generator_panel.dart';
import 'credentials_controller.dart';
import 'url.dart';

class AddCredentialScreen extends ConsumerStatefulWidget {
  const AddCredentialScreen({super.key, this.initialPassword});

  final String? initialPassword;

  @override
  ConsumerState<AddCredentialScreen> createState() => _AddCredentialScreenState();
}

class _AddCredentialScreenState extends ConsumerState<AddCredentialScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _url = TextEditingController();
  final _username = TextEditingController();
  late final _password = TextEditingController(text: widget.initialPassword ?? '');
  final _mfa = TextEditingController();
  bool _generating = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    for (final c in [_name, _url, _username, _password, _mfa]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (!(_form.currentState?.validate() ?? false) || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final mfa = _mfa.text.trim();
      await ref
          .read(credentialsProvider.notifier)
          .add(
            name: _name.text.trim(),
            url: normaliseUrl(_url.text),
            username: _username.text.trim(),
            password: _password.text,
            mfaSecret: mfa.isEmpty ? null : mfa,
          );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${_name.text.trim()} was saved.')));
        context.pop();
      }
    } catch (e) {
      if (mounted) setState(() => _error = messageFor(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String? _urlError(String? v) {
    try {
      normaliseUrl(v ?? '');
      return null;
    } on FormatException {
      return 'Enter a web address such as example.com.';
    }
  }

  @override
  Widget build(BuildContext context) {
    final gen = ref.watch(addGeneratorProvider);
    final preview = parseTotp(_mfa.text);
    return Scaffold(
      appBar: AppBar(title: const Text('Add credential')),
      body: SafeArea(
        child: Form(
          key: _form,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              TextFormField(
                controller: _name,
                decoration: const InputDecoration(labelText: 'Name'),
                validator: (v) => (v ?? '').trim().isEmpty ? 'Give this credential a name.' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _url,
                keyboardType: TextInputType.url,
                autocorrect: false,
                decoration: const InputDecoration(labelText: 'Website (optional)', hintText: 'example.com'),
                validator: _urlError,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _username,
                autocorrect: false,
                enableSuggestions: false,
                decoration: const InputDecoration(labelText: 'Username or email'),
              ),
              const SizedBox(height: 12),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: PasswordField(
                      controller: _password,
                      label: 'Password',
                      // An empty hint list keeps the platform from offering to save vault entries.
                      autofillHints: const [],
                      validator: (v) => (v ?? '').isEmpty ? 'Enter or generate a password.' : null,
                    ),
                  ),
                  IconButton(
                    tooltip: 'Generate a password',
                    isSelected: _generating,
                    icon: const Icon(Icons.casino_outlined),
                    onPressed: () => setState(() => _generating = !_generating),
                  ),
                ],
              ),
              if (_generating)
                Card(
                  margin: const EdgeInsets.only(top: 12),
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        GeneratorPanel(state: gen, controller: ref.read(addGeneratorProvider.notifier)),
                        const SizedBox(height: 12),
                        FilledButton(
                          onPressed: gen.value.isEmpty
                              ? null
                              : () => setState(() {
                                  _password.text = gen.value;
                                  _generating = false;
                                }),
                          child: const Text('Use this password'),
                        ),
                      ],
                    ),
                  ),
                ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _mfa,
                autocorrect: false,
                enableSuggestions: false,
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  labelText: 'Authenticator secret (optional)',
                  helperText: preview != null
                      ? 'Current code ${groupCode(totpCode(preview, DateTime.now().millisecondsSinceEpoch))}. Check it matches your authenticator.'
                      : 'The base32 key or otpauth link from two factor setup.',
                  helperMaxLines: 2,
                ),
                validator: (v) => (v ?? '').trim().isNotEmpty && parseTotp(v!) == null
                    ? 'This does not look like a valid authenticator secret.'
                    : null,
              ),
              const SizedBox(height: 16),
              if (_error != null) ...[ErrorBanner(_error!), const SizedBox(height: 12)],
              BusyButton(label: 'Save', busy: _busy, onPressed: _save),
            ],
          ),
        ),
      ),
    );
  }
}
