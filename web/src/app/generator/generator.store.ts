import { Injectable, computed, inject, signal } from '@angular/core';

import {
  DEFAULT_PASSPHRASE,
  DEFAULT_RANDOM,
  generatePassphrase,
  generatePassword,
  passphraseEntropy,
  passwordEntropy,
  strengthOf,
  type PassphraseOptions,
  type RandomOptions,
} from '@zaltys/vault-core';
import { WORDLIST_SIZE, WordlistService } from './wordlist.service';

export type GeneratorMode = 'random' | 'passphrase';

/**
 * State for one generator instance. Provided per component so the generator page and the
 * inline generator in the add dialog do not share values.
 */
@Injectable()
export class GeneratorStore {
  private readonly wordlist = inject(WordlistService);
  private words: readonly string[] | null = null;

  readonly mode = signal<GeneratorMode>('random');
  readonly random = signal<RandomOptions>(DEFAULT_RANDOM);
  readonly passphrase = signal<PassphraseOptions>(DEFAULT_PASSPHRASE);
  readonly value = signal('');
  readonly error = signal('');

  readonly entropy = computed(() =>
    this.mode() === 'random'
      ? passwordEntropy(this.random())
      : passphraseEntropy(WORDLIST_SIZE, this.passphrase()),
  );
  readonly strength = computed(() => strengthOf(this.entropy()));

  constructor() {
    this.regenerate();
  }

  setMode(mode: GeneratorMode): void {
    this.mode.set(mode);
    this.regenerate();
  }

  updateRandom(patch: Partial<RandomOptions>): void {
    const next = { ...this.random(), ...patch };
    if (next.classes.length === 0) return;
    this.random.set(next);
    this.regenerate();
  }

  updatePassphrase(patch: Partial<PassphraseOptions>): void {
    this.passphrase.set({ ...this.passphrase(), ...patch });
    this.regenerate();
  }

  regenerate(): void {
    this.error.set('');
    if (this.mode() === 'random') {
      this.value.set(generatePassword(this.random()));
      return;
    }
    if (this.words) {
      this.value.set(generatePassphrase(this.words, this.passphrase()));
      return;
    }
    this.value.set('');
    this.wordlist.load().then(
      (w) => {
        this.words = w;
        if (this.mode() === 'passphrase') this.value.set(generatePassphrase(w, this.passphrase()));
      },
      () => this.error.set('The word list could not be loaded. Random passwords still work.'),
    );
  }
}
