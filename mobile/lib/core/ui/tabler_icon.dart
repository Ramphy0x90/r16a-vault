import 'package:flutter/widgets.dart';
import 'package:tabler_icons_next/tabler_icons_next.dart' as tabler;

/// Renders a Tabler icon with the colour and size of the surrounding Flutter IconTheme.
/// Tabler widgets read only their own theme, so without this bridge icons inside buttons,
/// list tiles and the navigation bar would ignore selected, disabled and brand colours.
class TIcon extends StatelessWidget {
  const TIcon(this.icon, {super.key, this.size, this.color});

  final tabler.Icon icon;
  final double? size;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final theme = IconTheme.of(context);
    final base = color ?? theme.color ?? const Color(0xFF000000);
    final resolved = base.withValues(alpha: base.a * (theme.opacity ?? 1));
    final px = size ?? theme.size ?? 24;
    return SizedBox.square(
      dimension: px,
      child: tabler.IconTheme(
        data: tabler.IconThemeData(color: resolved, size: px, strokeWidth: 1.75),
        child: icon,
      ),
    );
  }
}
