import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export const WORDLIST_SIZE = 7776;

/** Loads the bundled EFF wordlist once. A truncated or tampered file is refused outright. */
@Injectable({ providedIn: 'root' })
export class WordlistService {
  private readonly http = inject(HttpClient);
  private words: Promise<readonly string[]> | null = null;

  load(): Promise<readonly string[]> {
    this.words ??= firstValueFrom(
      this.http.get('/assets/eff_large_wordlist.txt', { responseType: 'text' }),
    ).then(
      (text) => {
        const list = text.trim().split('\n');
        if (list.length !== WORDLIST_SIZE || new Set(list).size !== WORDLIST_SIZE) {
          throw new Error('wordlist corrupted');
        }
        return Object.freeze(list);
      },
      (e: unknown) => {
        this.words = null;
        throw e;
      },
    );
    return this.words;
  }
}
