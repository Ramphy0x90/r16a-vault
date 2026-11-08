import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../prefs/prefs.dart';

/// Palette mirroring web/src/styles.css. Hue and saturation are fixed per family and every
/// shade is a lightness value, so the two clients stay visually identical.
class Hsl {
  static Color brand(double l) => HSLColor.fromAHSL(1, 160, 0.84, l / 100).toColor();
  static Color neutral(double l) => HSLColor.fromAHSL(1, 160, 0.08, l / 100).toColor();
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
    textMuted: Hsl.neutral(40),
    warningText: Hsl.warning(30),
    primarySoft: Hsl.brand(96),
    accent: Hsl.brand(39),
  );
  static final dark = Tokens(
    textMuted: Hsl.neutral(65),
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
  final scheme = ColorScheme(
    brightness: b,
    primary: light ? Hsl.brand(26) : Hsl.brand(50),
    onPrimary: light ? Colors.white : Hsl.neutral(7),
    secondary: light ? Hsl.brand(33) : Hsl.brand(65),
    onSecondary: light ? Colors.white : Hsl.neutral(7),
    error: light ? Hsl.danger(45) : Hsl.danger(65),
    onError: light ? Colors.white : Hsl.neutral(7),
    surface: light ? Colors.white : Hsl.neutral(11),
    onSurface: light ? Hsl.neutral(10) : Hsl.neutral(95),
    surfaceContainerHighest: light ? Hsl.neutral(95) : Hsl.neutral(18),
    outline: light ? Hsl.neutral(50) : Hsl.neutral(40),
    outlineVariant: light ? Hsl.neutral(90) : Hsl.neutral(18),
  );
  final tokens = light ? Tokens.light : Tokens.dark;
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: light ? Hsl.neutral(98) : Hsl.neutral(7),
    extensions: [tokens],
    materialTapTargetSize: MaterialTapTargetSize.padded,
    inputDecorationTheme: InputDecorationTheme(
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: BorderSide(color: scheme.outline),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: BorderSide(color: light ? Hsl.brand(33) : Hsl.brand(65), width: 2),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(44, 48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(44, 48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    ),
    cardTheme: CardThemeData(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: scheme.outlineVariant),
      ),
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
