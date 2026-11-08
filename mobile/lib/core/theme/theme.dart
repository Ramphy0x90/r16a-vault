import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../prefs/prefs.dart';

/// Palette mirroring web/src/styles.css. Hue and saturation are fixed per family and every
/// shade is a lightness value, so the two clients stay visually identical.
class Hsl {
  static Color brand(double l) => HSLColor.fromAHSL(1, 160, 0.84, l / 100).toColor();
  static Color neutral(double l) => HSLColor.fromAHSL(1, 160, 0.06, l / 100).toColor();
  static Color danger(double l) => HSLColor.fromAHSL(1, 0, 0.72, l / 100).toColor();
  static Color warning(double l) => HSLColor.fromAHSL(1, 38, 0.92, l / 100).toColor();
}

/// Semantic tokens per theme. The contrast ratios are listed in docs/SPEC.md section 10.2.
class Tokens extends ThemeExtension<Tokens> {
  const Tokens({required this.textMuted, required this.warningText, required this.primarySoft, required this.accent});

  final Color textMuted;
  final Color warningText;
  final Color primarySoft;
  final Color accent;

  static final light = Tokens(
    textMuted: Hsl.neutral(42),
    warningText: Hsl.warning(30),
    primarySoft: Hsl.brand(96),
    accent: Hsl.brand(39),
  );
  static final dark = Tokens(
    textMuted: Hsl.neutral(64),
    warningText: Hsl.warning(60),
    primarySoft: const HSLColor.fromAHSL(1, 160, 0.4, 0.14).toColor(),
    accent: Hsl.brand(50),
  );

  @override
  Tokens copyWith() => this;

  @override
  Tokens lerp(ThemeExtension<Tokens>? other, double t) => t < 0.5 ? this : (other as Tokens? ?? this);
}

ThemeData buildTheme(Brightness b) {
  final light = b == Brightness.light;
  // Ink primary with emerald kept for accents, matching the web app.
  final scheme = ColorScheme(
    brightness: b,
    primary: light ? Hsl.neutral(11) : Hsl.neutral(95),
    onPrimary: light ? Colors.white : Hsl.neutral(8),
    secondary: light ? Hsl.brand(39) : Hsl.brand(50),
    onSecondary: light ? Colors.white : Hsl.neutral(8),
    secondaryContainer: light ? Hsl.brand(95) : const HSLColor.fromAHSL(1, 160, 0.4, 0.14).toColor(),
    onSecondaryContainer: light ? Hsl.brand(26) : Hsl.brand(60),
    error: light ? Hsl.danger(45) : Hsl.danger(65),
    onError: light ? Colors.white : Hsl.neutral(6),
    surface: light ? Colors.white : Hsl.neutral(9),
    onSurface: light ? Hsl.neutral(9) : Hsl.neutral(95),
    onSurfaceVariant: light ? Hsl.neutral(42) : Hsl.neutral(64),
    surfaceContainerLowest: light ? Colors.white : Hsl.neutral(6),
    surfaceContainerLow: light ? Hsl.neutral(98.5) : Hsl.neutral(9),
    surfaceContainer: light ? Hsl.neutral(96.5) : Hsl.neutral(12.5),
    surfaceContainerHigh: light ? Hsl.neutral(94) : Hsl.neutral(14),
    surfaceContainerHighest: light ? Hsl.neutral(91.5) : Hsl.neutral(16),
    outline: light ? Hsl.neutral(54) : Hsl.neutral(40),
    outlineVariant: light ? Hsl.neutral(91.5) : Hsl.neutral(16),
  );
  final tokens = light ? Tokens.light : Tokens.dark;
  final radius = BorderRadius.circular(8);
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: light ? Hsl.neutral(98.5) : Hsl.neutral(6),
    extensions: [tokens],
    materialTapTargetSize: MaterialTapTargetSize.padded,
    splashFactory: InkSparkle.splashFactory,
    appBarTheme: AppBarTheme(
      backgroundColor: light ? Hsl.neutral(98.5) : Hsl.neutral(6),
      surfaceTintColor: Colors.transparent,
      scrolledUnderElevation: 0,
      titleTextStyle: TextStyle(
        fontSize: 20,
        fontWeight: FontWeight.w600,
        letterSpacing: -0.3,
        color: scheme.onSurface,
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: scheme.surface,
      surfaceTintColor: Colors.transparent,
      indicatorColor: scheme.secondaryContainer,
      iconTheme: WidgetStateProperty.resolveWith(
        (s) => IconThemeData(
          color: s.contains(WidgetState.selected) ? scheme.onSecondaryContainer : scheme.onSurfaceVariant,
        ),
      ),
      labelTextStyle: WidgetStateProperty.resolveWith(
        (s) => TextStyle(
          fontSize: 12,
          fontWeight: s.contains(WidgetState.selected) ? FontWeight.w600 : FontWeight.w500,
          color: s.contains(WidgetState.selected) ? scheme.onSurface : scheme.onSurfaceVariant,
        ),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      isDense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
      border: OutlineInputBorder(borderRadius: radius),
      enabledBorder: OutlineInputBorder(
        borderRadius: radius,
        borderSide: BorderSide(color: scheme.outline),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: radius,
        borderSide: BorderSide(color: light ? Hsl.brand(33) : Hsl.brand(55), width: 1.5),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(44, 48),
        shape: RoundedRectangleBorder(borderRadius: radius),
        textStyle: const TextStyle(fontWeight: FontWeight.w600),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(44, 48),
        foregroundColor: scheme.onSurface,
        side: BorderSide(color: scheme.outlineVariant),
        shape: RoundedRectangleBorder(borderRadius: radius),
      ),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: light ? Hsl.neutral(11) : Hsl.neutral(16),
      contentTextStyle: TextStyle(color: light ? Colors.white : Hsl.neutral(95)),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
    ),
    cardTheme: CardThemeData(
      elevation: 0,
      color: scheme.surface,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: scheme.outlineVariant),
      ),
    ),
    dividerTheme: DividerThemeData(color: scheme.outlineVariant, space: 1),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: scheme.surface,
      surfaceTintColor: Colors.transparent,
      showDragHandle: true,
    ),
  );
}

final themeModeProvider = NotifierProvider<ThemeModeController, ThemeMode>(ThemeModeController.new);

class ThemeModeController extends Notifier<ThemeMode> {
  @override
  ThemeMode build() => switch (ref.read(prefsProvider).getString(PrefKeys.theme)) {
    'light' => ThemeMode.light,
    'dark' => ThemeMode.dark,
    _ => ThemeMode.system,
  };

  void set(ThemeMode mode) {
    state = mode;
    ref.read(prefsProvider).setString(PrefKeys.theme, mode.name);
  }
}
