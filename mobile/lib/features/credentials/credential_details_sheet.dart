import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tabler_icons_next/tabler_icons_next.dart' as tabler;

import '../../core/api/api_error.dart';
import '../../core/clipboard/clipboard_service.dart';
import '../../core/crypto/vault_crypto.dart';
import '../../core/totp/totp.dart';
import '../../core/vault/vault_controller.dart';
import 'credentials_controller.dart';
import '../../core/ui/tabler_icon.dart';

const revealDuration = Duration(seconds: 30);
const totpVisibleDuration = Duration(seconds: 90);

/// Details for one credential. Secrets are decrypted only for the requested action and are
/// dropped on hide, on timeout, on lock and when the sheet closes.
class CredentialDetailsSheet extends ConsumerStatefulWidget {
  const CredentialDetailsSheet({super.key, required this.id, required this.meta});

  final String id;
  final CredentialMeta meta;

  @override
  ConsumerState<CredentialDetailsSheet> createState() => _CredentialDetailsSheetState();
}

class _CredentialDetailsSheetState extends ConsumerState<CredentialDetailsSheet> {
  String? _password;
  TotpConfig? _totp;
  Timer? _revealTimer;
  Timer? _totpTimer;
  Timer? _ticker;
  int _now = DateTime.now().millisecondsSinceEpoch;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _discard();
    super.dispose();
  }

  void _discard() {
    _revealTimer?.cancel();
    _totpTimer?.cancel();
    _ticker?.cancel();
    _password = null;
    _totp = null;
  }

  Future<CredentialSecret?> _secret() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      return await ref.read(credentialsProvider.notifier).openSecret(widget.id);
    } catch (_) {
      if (mounted) setState(() => _error = 'This secret could not be decrypted.');
      return null;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _toggleReveal() async {
    if (_password != null) {
      _revealTimer?.cancel();
      setState(() => _password = null);
      return;
    }
    final s = await _secret();
    if (s == null || !mounted) return;
    setState(() => _password = s.password);
    _revealTimer = Timer(revealDuration, () {
      if (mounted) setState(() => _password = null);
    });
  }

  Future<void> _copyPassword() async {
    final s = await _secret();
    if (s == null) return;
    await ref.read(clipboardServiceProvider).copy(s.password);
    _toast('Password copied. The clipboard will be cleared in 30 seconds.');
  }

  Future<void> _showTotp() async {
    final s = await _secret();
    final config = s?.mfaSecret == null ? null : parseTotp(s!.mfaSecret!);
    if (!mounted) return;
    if (config == null) {
      if (s != null) setState(() => _error = 'The stored one time code secret is not valid.');
      return;
    }
    setState(() {
      _totp = config;
      _now = DateTime.now().millisecondsSinceEpoch;
    });
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _now = DateTime.now().millisecondsSinceEpoch);
    });
    _totpTimer = Timer(totpVisibleDuration, _hideTotp);
  }

  /// Copies the current code whether or not it is shown, the same way the password copies
  /// while masked. The code is computed at the moment of copying so it is never stale.
  Future<void> _copyTotp() async {
    var config = _totp;
    if (config == null) {
      final s = await _secret();
      config = s?.mfaSecret == null ? null : parseTotp(s!.mfaSecret!);
      if (!mounted) return;
      if (config == null) {
        if (s != null) setState(() => _error = 'The stored one time code secret is not valid.');
        return;
      }
    }
    await ref.read(clipboardServiceProvider).copy(totpCode(config, DateTime.now().millisecondsSinceEpoch));
    _toast('Code copied. The clipboard will be cleared in 30 seconds.');
  }

  void _hideTotp() {
    _ticker?.cancel();
    _totpTimer?.cancel();
    if (mounted) setState(() => _totp = null);
  }

  void _toast(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _delete() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete credential'),
        content: Text('Delete ${widget.meta.name}? This cannot be undone.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Theme.of(ctx).colorScheme.error),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text('Delete ${widget.meta.name}'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await ref.read(credentialsProvider.notifier).remove(widget.id);
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) setState(() => _error = messageFor(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(vaultProvider.select((s) => s.lockEpoch), (_, _) {
      _discard();
      if (mounted) Navigator.of(context).maybePop();
    });
    final meta = widget.meta;
    final totp = _totp;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(meta.name, style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            _Row(
              label: 'Username',
              value: meta.username.isEmpty ? '–' : meta.username,
              actions: [
                if (meta.username.isNotEmpty)
                  IconButton(
                    tooltip: 'Copy username',
                    icon: const TIcon(tabler.Copy()),
                    onPressed: () async {
                      await ref.read(clipboardServiceProvider).copy(meta.username, sensitive: false);
                      _toast('Username copied.');
                    },
                  ),
              ],
            ),
            if (meta.url != null) _Row(label: 'Website', value: meta.url!),
            _Row(
              label: 'Password',
              value: _password ?? '••••••••••••',
              monospace: _password != null,
              actions: [
                IconButton(
                  tooltip: _password != null ? 'Hide password' : 'Reveal password',
                  isSelected: _password != null,
                  icon: const TIcon(tabler.Eye()),
                  selectedIcon: const TIcon(tabler.EyeOff()),
                  onPressed: _busy ? null : _toggleReveal,
                ),
                IconButton(
                  tooltip: 'Copy password',
                  icon: const TIcon(tabler.Copy()),
                  onPressed: _busy ? null : _copyPassword,
                ),
              ],
            ),
            if (meta.hasTotp)
              TotpView(
                code: totp == null ? null : totpCode(totp, _now),
                remaining: totp == null ? 0 : secondsRemaining(totp, _now),
                period: totp?.period ?? 30,
                busy: _busy,
                onToggle: totp == null ? _showTotp : _hideTotp,
                onCopy: _copyTotp,
              ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              ),
            const SizedBox(height: 16),
            Align(
              alignment: Alignment.centerRight,
              child: OutlinedButton.icon(
                style: OutlinedButton.styleFrom(foregroundColor: Theme.of(context).colorScheme.error),
                onPressed: _delete,
                icon: const TIcon(tabler.Trash()),
                label: const Text('Delete'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.label, required this.value, this.actions = const [], this.monospace = false});

  final String label;
  final String value;
  final List<Widget> actions;
  final bool monospace;

  @override
  Widget build(BuildContext context) => ConstrainedBox(
    constraints: const BoxConstraints(minHeight: 48),
    child: Row(
      children: [
        SizedBox(width: 92, child: Text(label, style: Theme.of(context).textTheme.labelLarge)),
        Expanded(
          child: SelectableText(value, style: monospace ? const TextStyle(fontFamily: 'monospace') : null),
        ),
        ...actions,
      ],
    ),
  );
}

/// One time code row that behaves like the password row. Hidden it shows dots, shown it shows
/// the live code and countdown. Presentational, the parent drives the clock and holds the secret.
class TotpView extends StatelessWidget {
  const TotpView({
    super.key,
    required this.code,
    required this.remaining,
    required this.period,
    required this.busy,
    required this.onToggle,
    required this.onCopy,
  });

  final String? code;
  final int remaining;
  final int period;
  final bool busy;
  final VoidCallback onToggle;
  final VoidCallback onCopy;

  @override
  Widget build(BuildContext context) {
    final reduceMotion = MediaQuery.of(context).disableAnimations;
    final scheme = Theme.of(context).colorScheme;
    final shown = code;
    return ConstrainedBox(
      constraints: const BoxConstraints(minHeight: 48),
      child: Row(
        children: [
          SizedBox(width: 92, child: Text('One time code', style: Theme.of(context).textTheme.labelLarge)),
          Expanded(
            child: shown == null
                ? const Text('••• •••', semanticsLabel: 'Hidden')
                : Text(
                    groupCode(shown),
                    style: const TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 22,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 1.5,
                    ),
                  ),
          ),
          if (shown != null)
            Semantics(
              label: '$remaining seconds remaining',
              child: SizedBox(
                width: 36,
                height: 36,
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    TweenAnimationBuilder<double>(
                      tween: Tween(end: remaining / period),
                      duration: reduceMotion ? Duration.zero : const Duration(seconds: 1),
                      builder: (_, v, _) => CircularProgressIndicator(
                        value: v,
                        strokeWidth: 3.5,
                        color: remaining <= 5 ? scheme.error : null,
                        backgroundColor: scheme.outlineVariant,
                      ),
                    ),
                    ExcludeSemantics(
                      child: Text('$remaining', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                    ),
                  ],
                ),
              ),
            ),
          IconButton(
            tooltip: shown != null ? 'Hide one time code' : 'Reveal one time code',
            isSelected: shown != null,
            icon: const TIcon(tabler.Eye()),
            selectedIcon: const TIcon(tabler.EyeOff()),
            onPressed: busy ? null : onToggle,
          ),
          IconButton(tooltip: 'Copy one time code', icon: const TIcon(tabler.Copy()), onPressed: busy ? null : onCopy),
        ],
      ),
    );
  }
}
