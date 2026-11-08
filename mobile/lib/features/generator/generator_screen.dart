import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tabler_icons_next/tabler_icons_next.dart' as tabler;

import '../../core/clipboard/clipboard_service.dart';
import 'generator_controller.dart';
import 'generator_panel.dart';
import '../../core/ui/tabler_icon.dart';

class GeneratorScreen extends ConsumerWidget {
  const GeneratorScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(generatorProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Generator')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const Text('Generated on this device with a cryptographic random source. Nothing is sent to the server.'),
            const SizedBox(height: 16),
            GeneratorPanel(
              state: state,
              controller: ref.read(generatorProvider.notifier),
              trailing: IconButton(
                tooltip: 'Copy generated value',
                icon: const TIcon(tabler.Copy()),
                onPressed: state.value.isEmpty
                    ? null
                    : () async {
                        await ref.read(clipboardServiceProvider).copy(state.value);
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Copied. The clipboard will be cleared in 30 seconds.')),
                          );
                        }
                      },
              ),
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: state.value.isEmpty ? null : () => context.go('/vault/add', extra: state.value),
              icon: const TIcon(tabler.Plus()),
              label: const Text('Use in a new credential'),
            ),
          ],
        ),
      ),
    );
  }
}
