import { DOCUMENT, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { SessionService } from '../session/session.service';
import { VaultSessionStore } from '../vault/vault-session.store';
import { AutoLockService, HIDDEN_GRACE_MS } from './auto-lock.service';

describe('AutoLockService', () => {
  let lock: ReturnType<typeof vi.fn>;
  let visibility: DocumentVisibilityState;

  beforeEach(() => {
    vi.useFakeTimers();
    lock = vi.fn();
    visibility = 'visible';
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: SessionService, useValue: { lock } },
      ],
    });
    const doc = TestBed.inject(DOCUMENT);
    Object.defineProperty(doc, 'visibilityState', { configurable: true, get: () => visibility });
    TestBed.inject(VaultSessionStore).setUnlocked('alice', new Uint8Array(32));
    TestBed.inject(AutoLockService);
    TestBed.tick();
  });

  afterEach(() => vi.useRealTimers());

  it('locks after the idle timeout and activity postpones it', () => {
    vi.advanceTimersByTime(4 * 60_000);
    TestBed.inject(DOCUMENT).dispatchEvent(new Event('keydown'));
    vi.advanceTimersByTime(4 * 60_000);
    expect(lock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(lock).toHaveBeenCalledTimes(1);
  });

  it('locks when the tab stays hidden past the grace period', () => {
    visibility = 'hidden';
    TestBed.inject(DOCUMENT).dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(HIDDEN_GRACE_MS);
    expect(lock).toHaveBeenCalled();
  });
});
