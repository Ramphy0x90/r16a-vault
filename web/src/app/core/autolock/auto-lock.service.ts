import { DOCUMENT, DestroyRef, Injectable, effect, inject, signal } from '@angular/core';

import { SessionService } from '../session/session.service';
import { readPref, writePref } from '../ui/preferences';
import { VaultSessionStore } from '../vault/vault-session.store';

const KEY = 'r16a.autolockMinutes';
export const AUTO_LOCK_CHOICES = [1, 5, 15, 30] as const;
export const DEFAULT_AUTO_LOCK_MINUTES = 5;
/** A hidden tab locks after this grace period, which covers quick tab switches. */
export const HIDDEN_GRACE_MS = 60_000;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * Locks the vault after inactivity and when the tab stays hidden. Activity resets the
 * timer, which is throttled so typing does not churn timers.
 */
@Injectable({ providedIn: 'root' })
export class AutoLockService {
  private readonly doc = inject(DOCUMENT);
  private readonly store = inject(VaultSessionStore);
  private readonly session = inject(SessionService);
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private hiddenTimer: ReturnType<typeof setTimeout> | null = null;
  private lastReset = 0;

  readonly minutes = signal<number>(AutoLockService.read());

  private static read(): number {
    const v = Number(readPref(KEY));
    return (AUTO_LOCK_CHOICES as readonly number[]).includes(v) ? v : DEFAULT_AUTO_LOCK_MINUTES;
  }

  constructor() {
    // The listeners sit on the shared document, so they must go with the injector. A stale
    // instance would otherwise keep reacting to activity and lock through an old session.
    const listeners = new AbortController();
    const { signal: abort } = listeners;
    inject(DestroyRef).onDestroy(() => {
      listeners.abort();
      this.clear();
    });
    const onActivity = () => this.activity();
    for (const ev of ACTIVITY_EVENTS)
      this.doc.addEventListener(ev, onActivity, { passive: true, capture: true, signal: abort });
    this.doc.addEventListener('visibilitychange', () => this.visibility(), { signal: abort });
    effect(() => {
      this.minutes();
      if (this.store.unlocked()) this.restart();
      else this.clear();
    });
  }

  setMinutes(m: number): void {
    if (!(AUTO_LOCK_CHOICES as readonly number[]).includes(m)) return;
    this.minutes.set(m);
    writePref(KEY, String(m));
  }

  private activity(): void {
    const now = Date.now();
    if (!this.store.unlocked() || now - this.lastReset < 1000) return;
    this.lastReset = now;
    this.restart();
  }

  private visibility(): void {
    if (this.hiddenTimer) clearTimeout(this.hiddenTimer);
    this.hiddenTimer = null;
    if (this.doc.visibilityState === 'hidden' && this.store.unlocked()) {
      this.hiddenTimer = setTimeout(() => this.session.lock(), HIDDEN_GRACE_MS);
    }
  }

  private restart(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.session.lock(), this.minutes() * 60_000);
  }

  private clear(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.hiddenTimer) clearTimeout(this.hiddenTimer);
    this.idleTimer = null;
    this.hiddenTimer = null;
  }
}
