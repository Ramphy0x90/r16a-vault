import 'package:flutter/material.dart';
import 'package:tabler_icons_next/tabler_icons_next.dart' as tabler;

import '../../core/theme/theme.dart';
import 'generator.dart';
import 'generator_controller.dart';
import '../../core/ui/tabler_icon.dart';

const _classLabels = {
  CharClass.upper: 'Uppercase A to Z',
  CharClass.lower: 'Lowercase a to z',
  CharClass.digits: 'Digits 0 to 9',
  CharClass.symbols: 'Symbols',
};

/// Presentational generator controls. State lives in the GeneratorController passed in.
class GeneratorPanel extends StatelessWidget {
  const GeneratorPanel({super.key, required this.state, required this.controller, this.trailing});

  final GeneratorState state;
  final GeneratorController controller;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final tokens = Theme.of(context).extension<Tokens>()!;
    final strengthColor = switch (state.strength) {
      Strength.weak => scheme.error,
      Strength.fair => tokens.warningText,
      _ => tokens.accent,
    };
    final label = state.strength.name[0].toUpperCase() + state.strength.name.substring(1);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          padding: const EdgeInsets.only(left: 12),
          decoration: BoxDecoration(color: scheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(10)),
          child: Row(
            children: [
              Expanded(
                child: SelectableText(
                  state.value.isEmpty ? '…' : state.value,
                  style: const TextStyle(fontFamily: 'monospace', fontSize: 16),
                ),
              ),
              IconButton(
                tooltip: 'Generate another',
                icon: const TIcon(tabler.Refresh()),
                onPressed: controller.regenerate,
              ),
              ?trailing,
            ],
          ),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: LinearProgressIndicator(
                value: (state.entropy / 128).clamp(0, 1),
                color: strengthColor,
                minHeight: 6,
              ),
            ),
            const SizedBox(width: 12),
            Text('$label · about ${state.entropy.floor()} bits'),
          ],
        ),
        if (state.error != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(state.error!, style: TextStyle(color: scheme.error)),
          ),
        const SizedBox(height: 12),
        SegmentedButton<GeneratorMode>(
          segments: const [
            ButtonSegment(value: GeneratorMode.random, label: Text('Password')),
            ButtonSegment(value: GeneratorMode.passphrase, label: Text('Passphrase')),
          ],
          selected: {state.mode},
          onSelectionChanged: (s) => controller.setMode(s.first),
        ),
        const SizedBox(height: 8),
        if (state.mode == GeneratorMode.random) ...[
          Text('Length ${state.random.length}'),
          Slider(
            min: minLength.toDouble(),
            max: maxLength.toDouble(),
            value: state.random.length.toDouble(),
            label: '${state.random.length}',
            onChanged: (v) => controller.updateRandom(state.random.copyWith(length: v.round())),
          ),
          for (final c in CharClass.values)
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(_classLabels[c]!),
              value: state.random.classes.contains(c),
              onChanged: state.random.classes.length == 1 && state.random.classes.contains(c)
                  ? null
                  : (on) => controller.updateRandom(
                      state.random.copyWith(
                        classes: on == true ? {...state.random.classes, c} : ({...state.random.classes}..remove(c)),
                      ),
                    ),
            ),
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Avoid look alike characters such as l, 1, O and 0'),
            value: state.random.excludeAmbiguous,
            onChanged: (on) => controller.updateRandom(state.random.copyWith(excludeAmbiguous: on ?? true)),
          ),
        ] else ...[
          Text('Words ${state.passphrase.words}'),
          Slider(
            min: minWords.toDouble(),
            max: maxWords.toDouble(),
            divisions: maxWords - minWords,
            value: state.passphrase.words.toDouble(),
            label: '${state.passphrase.words}',
            onChanged: (v) => controller.updatePassphrase(state.passphrase.copyWith(words: v.round())),
          ),
          DropdownButtonFormField<String>(
            initialValue: state.passphrase.separator,
            decoration: const InputDecoration(labelText: 'Separator'),
            items: const [
              DropdownMenuItem(value: '-', child: Text('Hyphen')),
              DropdownMenuItem(value: ' ', child: Text('Space')),
              DropdownMenuItem(value: '.', child: Text('Dot')),
              DropdownMenuItem(value: '_', child: Text('Underscore')),
              DropdownMenuItem(value: '', child: Text('None')),
            ],
            onChanged: (v) => controller.updatePassphrase(state.passphrase.copyWith(separator: v ?? '-')),
          ),
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Capitalise words'),
            value: state.passphrase.capitalise,
            onChanged: (on) => controller.updatePassphrase(state.passphrase.copyWith(capitalise: on ?? true)),
          ),
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Include a number'),
            value: state.passphrase.includeNumber,
            onChanged: (on) => controller.updatePassphrase(state.passphrase.copyWith(includeNumber: on ?? false)),
          ),
        ],
      ],
    );
  }
}
