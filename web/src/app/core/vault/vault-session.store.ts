import { Injectable, computed, signal } from '@angular/core';

export type VaultStatus = 'unknown' | 'anonymous' | 'locked' | 'unlocked';

/**
 * Holds lock state and the in memory vault key. The key lives in a private field, is
 * never persisted anywhere, and is wiped on lock. Code outside the vault features reaches
 * it only through `withKey`, so it cannot be stored by accident.
 */
@Injectable({ providedIn: 'root' })
export class VaultSessionStore {
  private vaultKey: Uint8Array | null = null;

  readonly status = signal<VaultStatus>('unknown');
  readonly username = signal<string | null>(null);
  /** Increments on every lock so views holding decrypted secrets can drop them. */
  readonly lockEpoch = signal(0);
  readonly unlocked = computed(() => this.status() === 'unlocked');

  setUnlocked(username: string, vaultKey: Uint8Array): void {
    this.wipeKey();
    this.vaultKey = vaultKey;
    this.username.set(username);
    this.status.set('unlocked');
  }

  setLocked(username: string): void {
    this.wipeKey();
    this.username.set(username);
    this.status.set('locked');
    this.lockEpoch.update((n) => n + 1);
  }

  setAnonymous(): void {
    this.wipeKey();
    this.username.set(null);
    this.status.set('anonymous');
    this.lockEpoch.update((n) => n + 1);
  }

  lock(): void {
    if (this.status() !== 'unlocked') return;
    this.setLocked(this.username() ?? '');
  }

  async withKey<T>(fn: (key: Uint8Array) => Promise<T>): Promise<T> {
    const key = this.vaultKey;
    if (!key) throw new Error('vault is locked');
    return fn(key);
  }

  private wipeKey(): void {
    this.vaultKey?.fill(0);
    this.vaultKey = null;
  }
}
