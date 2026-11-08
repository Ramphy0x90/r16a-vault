import { DOCUMENT, Injectable, effect, inject, untracked } from '@angular/core';

import { ToastService } from '../ui/toast.service';
import { VaultSessionStore } from '../vault/vault-session.store';

export const CLIPBOARD_CLEAR_MS = 30_000;

/**
 * Copies secrets and clears them again after 30 seconds.
 *
 * If the browser lets us read the clipboard, it is cleared only while it still holds our
 * value. If reading is refused, it is cleared regardless, a trade off accepted in SPEC
 * section 11 (D14). Browsers only allow clipboard writes while the page has focus, and the
 * usual flow is to copy and switch to another tab to paste, so a clear that cannot run yet
 * stays pending and is retried as soon as the page is focused again. Locking or signing out
 * clears a pending secret immediately when possible.
 */
@Injectable({ providedIn: 'root' })
export class ClipboardService {
  private readonly toast = inject(ToastService);
  private readonly doc = inject(DOCUMENT);
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The sensitive value we last copied and have not managed to clear yet. */
  private pending: string | null = null;

  constructor() {
    const retry = (): void => {
      if (this.pending !== null && !this.timer && this.doc.visibilityState === 'visible')
        void this.clear();
    };
    this.doc.defaultView?.addEventListener('focus', retry);
    this.doc.addEventListener('visibilitychange', retry);

    const vault = inject(VaultSessionStore);
    let first = true;
    effect(() => {
      vault.lockEpoch();
      if (first) {
        first = false;
        return;
      }
      untracked(() => {
        if (this.pending === null) return;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        void this.clear();
      });
    });
  }

  async copy(value: string, label: string, sensitive = true): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      this.toast.show('Copying failed. Your browser blocked clipboard access.', 'error');
      return false;
    }
    if (!sensitive) {
      this.toast.show(`${label} copied.`, 'success');
      return true;
    }
    this.toast.show(
      `${label} copied. The clipboard will be cleared in 30 seconds.`,
      'success',
      5000,
    );
    this.pending = value;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.clear();
    }, CLIPBOARD_CLEAR_MS);
    return true;
  }

  /** Clears the clipboard if it still holds the pending value. Stays pending when the browser refuses. */
  private async clear(): Promise<void> {
    const value = this.pending;
    if (value === null) return;
    let current: string | null;
    try {
      current = await navigator.clipboard.readText();
    } catch {
      current = null;
    }
    if (current !== null && current !== value) {
      this.pending = null;
      return;
    }
    try {
      await navigator.clipboard.writeText('');
      if (this.pending === value) this.pending = null;
    } catch {
      // Not focused. The focus and visibility listeners retry when the user comes back.
    }
  }
}
