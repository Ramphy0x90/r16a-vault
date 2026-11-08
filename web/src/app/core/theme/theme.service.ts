import { DOCUMENT, Injectable, inject, signal } from '@angular/core';

import { readPref, writePref } from '../ui/preferences';

export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'r16a.theme';

/**
 * Applies the theme by setting `data-theme` on the root element. The same logic runs in
 * public/theme-init.js before Angular boots, which prevents a flash of the wrong theme.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  readonly choice = signal<ThemeChoice>(ThemeService.read());

  private static read(): ThemeChoice {
    const v = readPref(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  }

  set(choice: ThemeChoice): void {
    this.choice.set(choice);
    writePref(KEY, choice);
    this.apply();
  }

  apply(): void {
    const root = this.doc.documentElement;
    const c = this.choice();
    if (c === 'system') delete root.dataset['theme'];
    else root.dataset['theme'] = c;
  }
}
