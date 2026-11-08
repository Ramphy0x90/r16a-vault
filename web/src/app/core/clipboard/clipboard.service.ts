import { Injectable, inject } from '@angular/core';

import { ToastService } from '../ui/toast.service';

export const CLIPBOARD_CLEAR_MS = 30_000;

/**
 * Copies secrets and clears them again after 30 seconds. If the browser lets us read the
 * clipboard, it is cleared only when it still holds our value. If reading is refused, it
 * is cleared regardless, a trade off accepted in SPEC section 11 (D14).
 */
@Injectable({ providedIn: 'root' })
export class ClipboardService {
  private readonly toast = inject(ToastService);
  private timer: ReturnType<typeof setTimeout> | null = null;

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
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.clearIfUnchanged(value), CLIPBOARD_CLEAR_MS);
    return true;
  }

  private async clearIfUnchanged(value: string): Promise<void> {
    this.timer = null;
    let current: string | null;
    try {
      current = await navigator.clipboard.readText();
    } catch {
      current = null;
    }
    if (current !== null && current !== value) return;
    try {
      await navigator.clipboard.writeText('');
    } catch {
      // Writing needs document focus. If the tab is in the background there is nothing more we can do.
    }
  }
}
