import 'package:flutter/material.dart';

import '../../core/theme/theme.dart';
import 'credentials_controller.dart';
import 'url.dart';

const _hues = <double>[160, 200, 250, 290, 330, 20, 45, 100];

/// One list row. Presentational, it only reports taps. The initial letter avatar replaces
/// favicons, which would tell third parties which sites the vault holds.
class CredentialTile extends StatelessWidget {
  const CredentialTile({super.key, required this.entry, required this.onTap});

  final CredentialEntry entry;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final meta = entry.meta;
    final tokens = Theme.of(context).extension<Tokens>()!;
    final dark = Theme.of(context).brightness == Brightness.dark;
    if (meta == null) {
      return ListTile(
        minTileHeight: 64,
        leading: CircleAvatar(
          backgroundColor: Theme.of(context).colorScheme.error.withValues(alpha: 0.15),
          child: Icon(Icons.priority_high, color: Theme.of(context).colorScheme.error),
        ),
        title: const Text('Unreadable entry'),
        subtitle: const Text('This entry could not be decrypted and may have been tampered with.'),
      );
    }
    final hue = _hues[meta.name.codeUnits.fold<int>(0, (h, c) => (h * 31 + c) & 0x7fffffff) % _hues.length];
    final subtitle = [meta.username, hostOf(meta.url)].where((s) => s.isNotEmpty).join(' · ');
    return ListTile(
      minTileHeight: 64,
      onTap: onTap,
      leading: ExcludeSemantics(
        child: CircleAvatar(
          backgroundColor: HSLColor.fromAHSL(1, hue, dark ? 0.35 : 0.7, dark ? 0.22 : 0.9).toColor(),
          foregroundColor: HSLColor.fromAHSL(1, hue, 0.7, dark ? 0.85 : 0.22).toColor(),
          child: Text(
            meta.name.trim().isEmpty ? '?' : meta.name.trim().characters.first.toUpperCase(),
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
        ),
      ),
      title: Text(
        meta.name,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontWeight: FontWeight.w600),
      ),
      subtitle: subtitle.isEmpty ? null : Text(subtitle, maxLines: 1, overflow: TextOverflow.ellipsis),
      trailing: meta.hasTotp
          ? Semantics(
              label: 'Has a one time code',
              child: Chip(
                label: const Text('2FA'),
                visualDensity: VisualDensity.compact,
                backgroundColor: tokens.primarySoft,
                side: BorderSide.none,
              ),
            )
          : const Icon(Icons.chevron_right),
    );
  }
}
