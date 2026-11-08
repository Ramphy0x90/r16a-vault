import 'package:flutter/widgets.dart';
import 'package:no_screenshot/no_screenshot.dart';

/// Blocks screenshots and blurs the app switcher preview while a vault screen is shown.
/// Failures are ignored, since protection is defence in depth and must not break the UI.
class SecureScreen extends StatefulWidget {
  const SecureScreen({super.key, required this.child});

  final Widget child;

  @override
  State<SecureScreen> createState() => _SecureScreenState();
}

class _SecureScreenState extends State<SecureScreen> {
  @override
  void initState() {
    super.initState();
    _apply(true);
  }

  @override
  void dispose() {
    _apply(false);
    super.dispose();
  }

  Future<void> _apply(bool on) async {
    try {
      final plugin = NoScreenshot.instance;
      if (on) {
        await plugin.screenshotOff();
        await plugin.screenshotWithBlur();
      } else {
        await plugin.overlayOff();
        await plugin.screenshotOn();
      }
    } catch (_) {
      // Not available in tests or on unsupported platforms.
    }
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
