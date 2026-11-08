import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_error.dart';
import '../../core/autolock/auto_lock.dart';
import '../../core/session/session_service.dart';
import '../../core/theme/theme.dart';
import '../../core/vault/vault_controller.dart';
import '../auth/register_screen.dart' show minMasterPassword;
import '../auth/widgets.dart';
import 'sessions_section.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  final _current = TextEditingController();
  final _next = TextEditingController();
  final _confirm = TextEditingController();
  final _allPw = TextEditingController();
  final _delUser = TextEditingController();
  final _delPw = TextEditingController();
  final _pwForm = GlobalKey<FormState>();
  bool _busy = false;
  String? _pwError;
  String? _allError;
  String? _delError;

  @override
  void dispose() {
    for (final c in [_current, _next, _confirm, _allPw, _delUser, _delPw]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _run(void Function(String?) setError, Future<void> Function() fn) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      setError(null);
    });
    try {
      await fn();
    } catch (e) {
      if (mounted) setState(() => setError(messageFor(e)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final mode = ref.watch(themeModeProvider);
    final minutes = ref.watch(autoLockMinutesProvider);
    final username = ref.watch(vaultProvider.select((s) => s.username)) ?? '';
    final session = ref.read(sessionServiceProvider);
    final canDelete = _delUser.text.trim().toLowerCase() == username.toLowerCase() && _delPw.text.isNotEmpty;

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _Section(
              title: 'Appearance',
              children: [
                SegmentedButton<ThemeMode>(
                  segments: const [
                    ButtonSegment(value: ThemeMode.system, label: Text('System')),
                    ButtonSegment(value: ThemeMode.light, label: Text('Light')),
                    ButtonSegment(value: ThemeMode.dark, label: Text('Dark')),
                  ],
                  selected: {mode},
                  onSelectionChanged: (s) => ref.read(themeModeProvider.notifier).set(s.first),
                ),
              ],
            ),
            _Section(
              title: 'Auto lock',
              children: [
                DropdownButtonFormField<int>(
                  initialValue: minutes,
                  decoration: const InputDecoration(
                    labelText: 'Lock after inactivity',
                    helperText: 'The vault also locks 30 seconds after the app goes to the background.',
                  ),
                  items: [
                    for (final m in autoLockChoices)
                      DropdownMenuItem(value: m, child: Text('$m minute${m == 1 ? '' : 's'}')),
                  ],
                  onChanged: (m) => ref.read(autoLockMinutesProvider.notifier).set(m ?? defaultAutoLockMinutes),
                ),
              ],
            ),
            _Section(
              title: 'Change master password',
              children: [
                Form(
                  key: _pwForm,
                  onChanged: () => const UserActivity().dispatch(context),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      PasswordField(controller: _current, label: 'Current master password'),
                      const SizedBox(height: 12),
                      PasswordField(
                        controller: _next,
                        label: 'New master password',
                        autofillHints: const [AutofillHints.newPassword],
                        validator: (v) =>
                            (v ?? '').length < minMasterPassword ? 'Use at least $minMasterPassword characters.' : null,
                      ),
                      const SizedBox(height: 12),
                      PasswordField(
                        controller: _confirm,
                        label: 'Confirm new master password',
                        autofillHints: const [AutofillHints.newPassword],
                        validator: (v) => v != _next.text ? 'The passwords do not match.' : null,
                      ),
                      const SizedBox(height: 12),
                      if (_pwError != null) ...[ErrorBanner(_pwError!), const SizedBox(height: 12)],
                      BusyButton(
                        label: 'Change master password',
                        busy: _busy,
                        onPressed: () {
                          if (!(_pwForm.currentState?.validate() ?? false)) return;
                          final messenger = ScaffoldMessenger.of(context);
                          _run((e) => _pwError = e, () async {
                            await session.changeMasterPassword(_current.text, _next.text);
                            for (final c in [_current, _next, _confirm]) {
                              c.clear();
                            }
                            if (mounted) {
                              messenger.showSnackBar(
                                const SnackBar(
                                  content: Text('Master password changed. Other sessions were signed out.'),
                                ),
                              );
                            }
                          });
                        },
                      ),
                    ],
                  ),
                ),
              ],
            ),
            _Section(
              title: 'Sessions',
              children: [
                const SessionsSection(),
                const Divider(height: 24),
                const Text('Or sign out on every device at once, including this one.'),
                const SizedBox(height: 12),
                PasswordField(controller: _allPw, label: 'Master password'),
                const SizedBox(height: 12),
                if (_allError != null) ...[ErrorBanner(_allError!), const SizedBox(height: 12)],
                OutlinedButton(
                  onPressed: _busy ? null : () => _run((e) => _allError = e, () => session.logoutAll(_allPw.text)),
                  child: const Text('Sign out of all sessions'),
                ),
              ],
            ),
            _Section(
              title: 'About',
              children: [
                const Text(
                  'r16a vault is built on open source software. Passphrases use the EFF large wordlist by the '
                  'Electronic Frontier Foundation, licensed CC BY 3.0 US, with the dice numbers removed.',
                ),
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerLeft,
                  child: OutlinedButton(
                    onPressed: () => showLicensePage(context: context, applicationName: 'r16a vault'),
                    child: const Text('Open source licences'),
                  ),
                ),
              ],
            ),
            _Section(
              title: 'Delete account',
              danger: true,
              children: [
                const Text('This permanently deletes your account and every credential in it. It cannot be undone.'),
                const SizedBox(height: 12),
                TextField(
                  controller: _delUser,
                  autocorrect: false,
                  onChanged: (_) {
                    const UserActivity().dispatch(context);
                    setState(() {});
                  },
                  decoration: InputDecoration(labelText: 'Type your username $username to confirm'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _delPw,
                  obscureText: true,
                  enableSuggestions: false,
                  autocorrect: false,
                  onChanged: (_) {
                    const UserActivity().dispatch(context);
                    setState(() {});
                  },
                  decoration: const InputDecoration(labelText: 'Master password'),
                ),
                const SizedBox(height: 12),
                if (_delError != null) ...[ErrorBanner(_delError!), const SizedBox(height: 12)],
                FilledButton(
                  style: FilledButton.styleFrom(backgroundColor: Theme.of(context).colorScheme.error),
                  onPressed: _busy || !canDelete
                      ? null
                      : () => _run((e) => _delError = e, () => session.deleteAccount(_delPw.text)),
                  child: const Text('Delete my account'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.children, this.danger = false});

  final String title;
  final List<Widget> children;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      shape: danger
          ? RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14),
              side: BorderSide(color: scheme.error),
            )
          : null,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(
              header: true,
              child: Text(title, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
            ),
            const SizedBox(height: 12),
            ...children,
          ],
        ),
      ),
    );
  }
}
