import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'generator.dart';

enum GeneratorMode { random, passphrase }

class GeneratorState {
  const GeneratorState({
    this.mode = GeneratorMode.random,
    this.random = const RandomOptions(),
    this.passphrase = const PassphraseOptions(),
    this.value = '',
    this.error,
  });

  final GeneratorMode mode;
  final RandomOptions random;
  final PassphraseOptions passphrase;
  final String value;
  final String? error;

  double get entropy => mode == GeneratorMode.random ? passwordEntropy(random) : passphraseEntropy(7776, passphrase);
  Strength get strength => strengthOf(entropy);

  GeneratorState copyWith({
    GeneratorMode? mode,
    RandomOptions? random,
    PassphraseOptions? passphrase,
    String? value,
    String? error,
  }) => GeneratorState(
    mode: mode ?? this.mode,
    random: random ?? this.random,
    passphrase: passphrase ?? this.passphrase,
    value: value ?? this.value,
    error: error,
  );
}

/// Loads the bundled EFF list once and refuses a truncated or duplicated file.
final wordlistProvider = FutureProvider<List<String>>((ref) async {
  final words = (await rootBundle.loadString('assets/eff_large_wordlist.txt')).trim().split('\n');
  if (words.length != 7776 || words.toSet().length != 7776) throw StateError('wordlist corrupted');
  return List.unmodifiable(words);
});

/// Two independent instances, one for the generator tab and one inside the add form.
final generatorProvider = NotifierProvider<GeneratorController, GeneratorState>(GeneratorController.new);
final addGeneratorProvider = NotifierProvider.autoDispose<GeneratorController, GeneratorState>(GeneratorController.new);

class GeneratorController extends Notifier<GeneratorState> {
  @override
  GeneratorState build() => GeneratorState(value: generatePassword(const RandomOptions()));

  void setMode(GeneratorMode mode) {
    state = state.copyWith(mode: mode);
    regenerate();
  }

  void updateRandom(RandomOptions o) {
    if (o.classes.isEmpty) return;
    state = state.copyWith(random: o);
    regenerate();
  }

  void updatePassphrase(PassphraseOptions o) {
    state = state.copyWith(passphrase: o);
    regenerate();
  }

  Future<void> regenerate() async {
    if (state.mode == GeneratorMode.random) {
      state = state.copyWith(value: generatePassword(state.random));
      return;
    }
    try {
      final words = await ref.read(wordlistProvider.future);
      state = state.copyWith(value: generatePassphrase(words, state.passphrase));
    } catch (_) {
      state = state.copyWith(value: '', error: 'The word list could not be loaded. Random passwords still work.');
    }
  }
}
