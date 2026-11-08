import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tabler_icons_next/tabler_icons_next.dart' as tabler;

import '../../core/api/api_client.dart';
import '../../core/api/api_error.dart';
import '../../core/api/dto.dart';
import '../../core/theme/theme.dart';
import '../../core/ui/tabler_icon.dart';

/// Where the account is signed in. Rebuilt on demand so a revoked session disappears at once.
final sessionsProvider = FutureProvider.autoDispose<List<SessionInfo>>(
  (ref) => ref.read(apiClientProvider).listSessions(),
);

/// A short device name from a stored user agent. Unknown formats get a neutral label.
String describeDevice(String? ua) {
  if (ua == null) return 'Unknown device';
  final app = RegExp(r'^r16a vault mobile \((\w+)\)').firstMatch(ua);
  if (app != null) return 'r16a vault app on ${app.group(1)}';
  const browsers = {'Edg/': 'Edge', 'Firefox/': 'Firefox', 'Chrome/': 'Chrome', 'Safari/': 'Safari'};
  const systems = {
    'Android': 'Android',
    'iPhone': 'iOS',
    'iPad': 'iOS',
    'Windows': 'Windows',
    'Mac OS X': 'macOS',
    'Linux': 'Linux',
  };
  final browser = browsers.entries.where((e) => ua.contains(e.key)).map((e) => e.value).firstOrNull;
  final system = systems.entries.where((e) => ua.contains(e.key)).map((e) => e.value).firstOrNull;
  if (browser == null && system == null) return 'Unknown device';
  return [browser ?? 'Browser', if (system != null) 'on $system'].join(' ');
}

String _ago(DateTime t) {
  final d = DateTime.now().difference(t);
  if (d.inMinutes < 1) return 'just now';
  if (d.inHours < 1) return '${d.inMinutes} min ago';
  if (d.inDays < 1) return '${d.inHours} h ago';
  return '${d.inDays} d ago';
}

class SessionsSection extends ConsumerWidget {
  const SessionsSection({super.key});

  Future<void> _revoke(BuildContext context, WidgetRef ref, SessionInfo s) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(apiClientProvider).revokeSession(s.id);
      ref.invalidate(sessionsProvider);
      messenger.showSnackBar(SnackBar(content: Text('Signed out ${describeDevice(s.userAgent)}.')));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(messageFor(e))));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final muted = Theme.of(context).extension<Tokens>()!.textMuted;
    return switch (ref.watch(sessionsProvider)) {
      AsyncData(:final value) => Column(
        children: [
          for (final s in value)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: TIcon(
                s.userAgent?.startsWith('r16a vault mobile') ?? false
                    ? const tabler.DeviceMobile()
                    : const tabler.DeviceDesktop(),
              ),
              title: Text(describeDevice(s.userAgent)),
              subtitle: Text(
                s.current ? 'This device' : 'Active ${_ago(s.lastSeenAt)}${s.locked ? ' · waiting for unlock' : ''}',
                style: TextStyle(color: muted),
              ),
              trailing: s.current
                  ? null
                  : TextButton(onPressed: () => _revoke(context, ref, s), child: const Text('Sign out')),
            ),
        ],
      ),
      AsyncError(:final error) => Row(
        children: [
          Expanded(child: Text(messageFor(error))),
          TextButton(onPressed: () => ref.invalidate(sessionsProvider), child: const Text('Try again')),
        ],
      ),
      _ => const Padding(
        padding: EdgeInsets.all(12),
        child: Center(child: CircularProgressIndicator()),
      ),
    };
  }
}
