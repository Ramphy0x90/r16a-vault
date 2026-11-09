import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/api/api_client.dart';
import 'core/clipboard/clipboard_service.dart';
import 'core/router.dart';
import 'core/session/session_service.dart';
import 'core/theme/theme.dart';

class R16aVaultApp extends ConsumerStatefulWidget {
  const R16aVaultApp({super.key});

  @override
  ConsumerState<R16aVaultApp> createState() => _R16aVaultAppState();
}

class _R16aVaultAppState extends ConsumerState<R16aVaultApp> {
  @override
  void initState() {
    super.initState();
    ref.read(clipboardServiceProvider);
    ref.read(sessionServiceProvider).bootstrap();
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(sessionExpiredProvider, (_, _) => ref.read(sessionServiceProvider).handleExpiry());
    return MaterialApp.router(
      title: 'Zaltys',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(Brightness.light),
      darkTheme: buildTheme(Brightness.dark),
      themeMode: ref.watch(themeModeProvider),
      routerConfig: ref.watch(routerProvider),
    );
  }
}
