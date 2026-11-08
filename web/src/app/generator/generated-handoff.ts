import { Injectable, signal } from '@angular/core';

/**
 * Passes a generated password from the generator page to the add credential dialog in
 * memory. It never travels through the URL, history state or storage, and is consumed once.
 */
@Injectable({ providedIn: 'root' })
export class GeneratedHandoff {
  private readonly pending = signal<string | null>(null);

  offer(value: string): void {
    this.pending.set(value);
  }

  take(): string | null {
    const v = this.pending();
    this.pending.set(null);
    return v;
  }
}
