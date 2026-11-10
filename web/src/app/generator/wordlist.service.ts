import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { parseWordlist } from '@zaltys/vault-core';
import { firstValueFrom } from 'rxjs';

export { WORDLIST_SIZE } from '@zaltys/vault-core';

/** Loads the bundled EFF wordlist once. A truncated or tampered file is refused outright. */
@Injectable({ providedIn: 'root' })
export class WordlistService {
  private readonly http = inject(HttpClient);
  private words: Promise<readonly string[]> | null = null;

  load(): Promise<readonly string[]> {
    this.words ??= firstValueFrom(
      this.http.get('/assets/eff_large_wordlist.txt', { responseType: 'text' }),
    ).then(
      (text) => parseWordlist(text),
      (e: unknown) => {
        this.words = null;
        throw e;
      },
    );
    return this.words;
  }
}
